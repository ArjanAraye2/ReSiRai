using System.Text.Json;
using ReSiRai.Api.Data;
using ReSiRai.Api.Models;
using ReSiRai.Api.Services;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ReSiRai.Api.Controllers;

// Reads one photographed/printed laboratory report and returns a review-only
// draft of the tests, each one matched against the clinical factor dictionary.
// A report of several pages is sent as ONE AI call - the pages belong together
// and no result row is lost at a page break.
//
// Nothing extracted by AI reaches the patient record automatically: the review
// screen shows the draft, a human confirms it, and the confirmed numbers are
// saved through POST api/factors/values with Source = 2 (lab-report extraction)
// and the ExtractionID of this batch - which keeps every number auditable.
[ApiController]
[Route("api/ai/images")]
public sealed class AiLabReportController : ControllerBase
{
    private readonly ReSiRaiDbContext _db;
    private readonly RadiologyStorageService _storage;
    private readonly StudyAccessService _studyAccess;
    private readonly AiClient _ai;

    public AiLabReportController(ReSiRaiDbContext db, RadiologyStorageService storage,
        StudyAccessService studyAccess, AiClient ai)
    {
        _db = db;
        _storage = storage;
        _studyAccess = studyAccess;
        _ai = ai;
    }

    public sealed class ExtractManyRequest
    {
        public int? StudyID { get; set; }
        public List<long> ImageIDs { get; set; } = new();
    }

    /// <summary>Extracts from one already attached image.</summary>
    [HttpPost("{imageID:long}/extract-lab")]
    public async Task<IActionResult> ExtractLab(long imageID, [FromQuery] int? studyID = null,
        CancellationToken cancellationToken = default)
    {
        var loaded = await LoadImageAsync(imageID, cancellationToken);
        if (loaded.error is not null) return loaded.error;

        var image = loaded.image!;
        string path = _storage.GetPhysicalPath(image.RelativePath);
        byte[] bytes = await System.IO.File.ReadAllBytesAsync(path, cancellationToken);
        return await ExtractCoreAsync(new List<(string Mime, byte[] Bytes)> { (image.ContentType, bytes) },
            image.RelativePath, image.RelativePath, studyID, cancellationToken);
    }

    /// <summary>
    /// Extracts from several images of ONE report (a multi-page lab sheet). All
    /// pages are read together in a single AI call.
    /// </summary>
    [HttpPost("extract-lab")]
    public async Task<IActionResult> ExtractLabMany(ExtractManyRequest request,
        CancellationToken cancellationToken = default)
    {
        if (request.ImageIDs is null || request.ImageIDs.Count == 0)
            return BadRequest(new { success = false, message = "دست‌کم یک تصویر لازم است." });
        var ids = request.ImageIDs.Distinct().ToList();
        if (ids.Count > 10)
            return BadRequest(new { success = false, message = "حداکثر ۱۰ صفحه در هر استخراج قابل انتخاب است." });

        var parts = new List<(string Mime, byte[] Bytes)>();
        var relPaths = new List<string>();
        string label = "";
        int page = 0;
        foreach (var id in ids)
        {
            var loaded = await LoadImageAsync(id, cancellationToken);
            if (loaded.error is not null) return loaded.error;

            var image = loaded.image!;
            string path = _storage.GetPhysicalPath(image.RelativePath);
            page++;
            if (page == 1) label = image.RelativePath;
            relPaths.Add(image.RelativePath);
            parts.Add((image.ContentType, await System.IO.File.ReadAllBytesAsync(path, cancellationToken)));
        }
        if (parts.Count > 1) label = $"{label} (+{parts.Count - 1} صفحه دیگر)";
        return await ExtractCoreAsync(parts, string.Join("|", relPaths), label, request.StudyID, cancellationToken);
    }

    /// <summary>
    /// Extracts from files picked on this device without attaching them to a
    /// visit first - the new-visit form needs the numbers before the visit row
    /// exists. Nothing is stored here; only the review draft is produced.
    /// </summary>
    [HttpPost("extract-lab-files")]
    public async Task<IActionResult> ExtractLabFiles(List<IFormFile> files,
        [FromQuery] int? studyID = null, CancellationToken cancellationToken = default)
    {
        if (files is null || files.Count == 0)
            return BadRequest(new { success = false, message = "دست‌کم یک فایل لازم است." });
        if (files.Count > 10)
            return BadRequest(new { success = false, message = "حداکثر ۱۰ صفحه در هر استخراج قابل انتخاب است." });

        var parts = new List<(string Mime, byte[] Bytes)>();
        var relPaths = new List<string>();
        string label = "";
        string folder = Path.Combine("_extractions", Guid.NewGuid().ToString("N"));
        foreach (var f in files)
        {
            if (f.Length == 0) continue;
            if (string.IsNullOrWhiteSpace(f.ContentType)
                || !f.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
                return BadRequest(new { success = false, message = "برای استخراج، فایل‌ها باید تصویر (JPG/PNG) باشند." });
            await using var ms = new MemoryStream();
            await f.CopyToAsync(ms, cancellationToken);
            byte[] bytes = ms.ToArray();
            if (label.Length == 0) label = f.FileName;
            parts.Add((f.ContentType, bytes));

            // صفحه‌ها ذخیره می‌شوند تا «تکهٔ برگه» و بازخوانیِ نقطه‌ای پشتِ هر
            // عدد قابلِ نمایش باشد؛ وابسته به همان دستهٔ استخراج‌اند.
            string ext = Path.GetExtension(f.FileName);
            if (ext.Length == 0 || ext.Length > 5) ext = ".jpg";
            string rel = Path.Combine(folder, $"page{parts.Count:00}{ext.ToLowerInvariant()}");
            string physical = _storage.GetPhysicalPath(rel);
            Directory.CreateDirectory(Path.GetDirectoryName(physical)!);
            await System.IO.File.WriteAllBytesAsync(physical, bytes, cancellationToken);
            relPaths.Add(rel);
        }
        if (parts.Count == 0)
            return BadRequest(new { success = false, message = "فایل تصویری معتبر انتخاب نشده است." });
        if (parts.Count > 1) label = $"{label} (+{parts.Count - 1} صفحه دیگر)";
        return await ExtractCoreAsync(parts, string.Join("|", relPaths), label, studyID, cancellationToken);
    }

    /// <summary>Loads one image and checks access, existence and file kind.</summary>
    private async Task<(RadiologyImage? image, IActionResult? error)> LoadImageAsync(long imageID,
        CancellationToken cancellationToken)
    {
        var image = await _db.RadiologyImages.AsNoTracking()
            .FirstOrDefaultAsync(x => x.ImageID == imageID, cancellationToken);
        if (image is null) return (null, NotFound(new { success = false, message = "تصویر پیدا نشد." }));

        var accessibleStudyIDs = _studyAccess.ApplyAccess(_db.RadiologyStudies.AsNoTracking(), User)
            .Select(x => x.StudyID);
        bool canAccess = StudyAccessService.IsSuperAdmin(User) || await _db.RadiologyStudyImages.AsNoTracking()
            .AnyAsync(x => x.ImageID == imageID && accessibleStudyIDs.Contains(x.StudyID), cancellationToken);
        if (!canAccess) return (null, NotFound(new { success = false, message = "تصویر پیدا نشد." }));

        if (!image.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
            return (null, BadRequest(new { success = false, message = "برای استخراج، تصویر باید JPG یا PNG باشد." }));

        string path = _storage.GetPhysicalPath(image.RelativePath);
        if (!System.IO.File.Exists(path))
            return (null, NotFound(new { success = false, message = "فایل تصویر روی دیسک پیدا نشد." }));

        return (image, null);
    }

    /// <summary>The shared extraction: one AI call over the pages, one batch row.</summary>
    private async Task<IActionResult> ExtractCoreAsync(List<(string Mime, byte[] Bytes)> parts,
        string pagesRelative, string fileLabel, int? studyID, CancellationToken cancellationToken)
    {
        // The deterministic path first: a printed table is read from the OCR text
        // exactly as printed - no model, no network, and above all no invented
        // rows. The AI path below stays only for sheets this parser cannot read.
        var parsed = new List<LabSheetParser.Row>();
        var gate = new object();
        // Pages are read in parallel: a phone photo of a sheet takes seconds of
        // OCR each and doctors upload several at once.
        await Parallel.ForEachAsync(parts.Select((p, i) => (Part: p, Index: i)),
            new ParallelOptions
            {
                MaxDegreeOfParallelism = Math.Clamp(parts.Count, 1, 3),
                CancellationToken = cancellationToken
            },
            async (x, ct) =>
            {
                try
                {
                    // مسیرِ قطعی: بازسازیِ جدول از TSV (مختصاتِ کلمات) که در
                    // برگه‌های متراکم ردیف‌ها را قاطی نمی‌کند؛ متنِ پشتیبان از
                    // همان TSV ساخته می‌شود، نه اجرای دوبارهٔ OCR.
                    var (tsv, upright) = await _ai.OcrDataAsync(x.Part.Bytes, ct);
                    var rows = LabSheetParser.ParseTsv(tsv);
                    if (rows.Count == 0)
                        rows = LabSheetParser.Parse(LabSheetParser.TsvToText(tsv));
                    if (rows.Count < 3)
                    {
                        // برگه وارونه؟ یک‌بار دیگر با چرخشِ ۱۸۰ و نگه‌داشتنِ
                        // نتیجهٔ بهتر؛ چیزی به خاطرِ جهتِ عکس گم نمی‌شود.
                        string turned = await _ai.OcrTsvTurnedAsync(x.Part.Bytes, ct);
                        var rows2 = LabSheetParser.ParseTsv(turned);
                        if (rows2.Count > rows.Count) rows = rows2;
                    }
                    if (rows.Count >= 3)
                        // سلول‌هایی که OCR گم کرده (فونتِ موربِ برگه‌ها) را فقط
                        // مدلِ بینایی می‌بیند؛ پیشنهادش علامت‌دار است و با تأییدِ
                        // پزشک ثبت می‌شود.
                        await SuggestMissingAsync(upright, rows, ct);
                    // هر ردیف بداند از کدام صفحه آمده تا «تکهٔ برگه» از همان
                    // صفحه بریده شود، نه از صفحهٔ اول.
                    for (int r = 0; r < rows.Count; r++) rows[r] = rows[r] with { Page = x.Index };
                    lock (gate) parsed.AddRange(rows);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    // One unreadable page must never sink the whole extraction.
                }
            });
        if (parsed.Count >= 3)
            return await BuildParsedResultAsync(parsed, pagesRelative, fileLabel, studyID, cancellationToken);

        string? configError = _ai.ConfigurationError();
        if (configError is not null)
            return StatusCode(503, new { success = false, message = configError });

        string pagesIntro = parts.Count == 1
            ? "This image is a printed laboratory report, possibly in Persian and/or English."
            : $"These {parts.Count} images are the pages (in the given order) of ONE printed laboratory report, possibly in Persian and/or English. Read all pages together and extract every test result row across all of them.";
        string prompt = $$"""
{{pagesIntro}}
Transcribe only what is printed. Never guess values or invent rows.
Extract every test result row you can read.
Return ONLY valid JSON with this exact shape:
{"notALabReport":false,"labName":"string|null","sampleDate":"string|null","tests":[{"name":"string","nameFa":"string|null","value":"string","unit":"string|null","refText":"string|null","refLow":null,"refHigh":null,"flag":"string|null"}]}
- name: test name exactly as printed (Latin or Persian)
- nameFa: the standard Persian name of this test if you know it, otherwise null
- value: the result exactly as printed, number or text, without the unit
- unit: unit exactly as printed, e.g. mg/dL
- refText: reference interval exactly as printed
- refLow / refHigh: numeric bounds when the interval is numeric, otherwise null
- flag: H, L or normal when the report prints such a mark, otherwise null
- sampleDate: sampling date exactly as printed, keeping its calendar
- labName: laboratory name if printed
If the images are not laboratory reports, return {"notALabReport":true,"labName":null,"sampleDate":null,"tests":[]}
""";

        string raw;
        try
        {
            raw = await _ai.CompleteJsonAsync(prompt, parts, cancellationToken);
        }
        catch (AiException e)
        {
            return StatusCode(e.HttpStatus, new { success = false, message = e.UserMessage, detail = e.Detail });
        }

        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(raw);
        }
        catch (JsonException)
        {
            return StatusCode(502, new { success = false, message = "پاسخ مدل قابل خواندن نبود." });
        }

        using (doc)
        {
            var root = doc.RootElement;
            if (root.TryGetProperty("notALabReport", out var flagEl) && flagEl.ValueKind == JsonValueKind.True)
                return BadRequest(new { success = false, message = "این تصویر برگه آزمایش نیست." });

            // The batch row is the audit trail of this extraction: it is written even
            // if the review screen is abandoned, so nothing disappears silently.
            var batch = new LabReportExtraction
            {
                StudyID = studyID ?? 0,
                FileName = fileLabel,
                ImagePath = pagesRelative.Length == 0 ? ""
                    : string.Join("|", pagesRelative.Split('|', StringSplitOptions.RemoveEmptyEntries).Select(_storage.GetPhysicalPath)),
                LabName = GetString(root, "labName"),
                SampleDate = ParseDate(GetString(root, "sampleDate")),
                RawJson = raw,
                Status = 1,
                CreatedDate = DateTime.Now
            };
            _db.LabReportExtractions.Add(batch);
            await _db.SaveChangesAsync(cancellationToken);

            var factors = await _db.ClinicalFactors.AsNoTracking()
                // A lab sheet only ever maps to lab factors - never to exam or
                // history observations that happen to share a word.
                .Where(x => x.IsActive && x.FactorCode.StartsWith("LAB."))
                .Select(x => new FactorInfo(x.FactorID, x.FactorCode, x.NameFa, x.NameEn, x.ShortCode, x.LoincCode, x.UnitUCUM, x.RefLow, x.RefHigh, x.DataType))
                .ToListAsync(cancellationToken);

            var items = new List<object>();
            int unmatched = 0;
            if (root.TryGetProperty("tests", out var tests) && tests.ValueKind == JsonValueKind.Array)
            {
                foreach (var t in tests.EnumerateArray())
                {
                    string name = GetString(t, "name") ?? string.Empty;
                    var best = MatchFactor(name, factors, LooksQualitative(GetString(t, "value")));
                    if (best is null) unmatched++;

                    items.Add(new
                    {
                        name,
                        nameFa = GetString(t, "nameFa"),
                        value = GetString(t, "value"),
                        unit = GetString(t, "unit"),
                        refText = GetString(t, "refText"),
                        refLow = GetDecimal(t, "refLow"),
                        refHigh = GetDecimal(t, "refHigh"),
                        flag = GetString(t, "flag"),
                        factorID = best?.FactorID,
                        factorCode = best?.FactorCode,
                        factorNameFa = best?.NameFa,
                        factorShortCode = best?.ShortCode,
                        factorUnit = best?.UnitUCUM,
                        matchConfidence = best?.Confidence ?? 0,
                        matchStatus = best is null ? "unmatched" : (best.Confidence >= 95 ? "matched" : "review")
                    });
                }
            }

            return Ok(new
            {
                success = true,
                imageID = (long?)null,
                extractionID = batch.ExtractionID,
                labName = batch.LabName,
                sampleDateRaw = GetString(root, "sampleDate"),
                sampleDate = batch.SampleDate,
                unmatchedCount = unmatched,
                items
            });
        }
    }

    /// <summary>
    /// The parsed table becomes the review draft: the rows are exactly what the
    /// sheet printed (decimal point restored from the reference range), each one
    /// matched against the factor dictionary.
    /// </summary>
    private async Task<IActionResult> BuildParsedResultAsync(List<LabSheetParser.Row> rows,
        string pagesRelative, string fileLabel, int? studyID, CancellationToken cancellationToken)
    {
        var batch = new LabReportExtraction
        {
            StudyID = studyID ?? 0,
            FileName = fileLabel,
            ImagePath = pagesRelative.Length == 0 ? ""
                : string.Join("|", pagesRelative.Split('|', StringSplitOptions.RemoveEmptyEntries).Select(_storage.GetPhysicalPath)),
            LabName = null,
            SampleDate = null,
            RawJson = JsonSerializer.Serialize(rows),
            Status = 1,
            CreatedDate = DateTime.Now
        };
        _db.LabReportExtractions.Add(batch);
        await _db.SaveChangesAsync(cancellationToken);

        var factors = await _db.ClinicalFactors.AsNoTracking()
            .Where(x => x.IsActive && x.FactorCode.StartsWith("LAB."))
            .Select(x => new FactorInfo(x.FactorID, x.FactorCode, x.NameFa, x.NameEn, x.ShortCode, x.LoincCode, x.UnitUCUM, x.RefLow, x.RefHigh, x.DataType))
            .ToListAsync(cancellationToken);

        // Pass one: match every row and hold its scale-fixed value. The
        // consistency rules must see the whole sheet before any row is written,
        // because they compare the rows against each other.
        int unmatched = 0;
        var work = new List<(LabSheetParser.Row Row, MatchResult? Best, string Value,
            decimal? Low, decimal? High, bool IsNumber, decimal Number)>();
        var obs = new List<LabObs>();
        foreach (var row in rows)
        {
            var best = MatchFactor(row.Name, factors, LooksQualitative(row.Value));
            if (best is null) unmatched++;
            // The dictionary's own range is the better ruler for the scale fix.
            bool useDict = best?.RefLow is not null || best?.RefHigh is not null;
            string value = row.Value.Length == 0
                ? ""
                : LabSheetParser.FitScale(row.Value,
                    useDict ? best!.RefLow : row.RefLow, useDict ? best!.RefHigh : row.RefHigh,
                    row.RefText);
            decimal? low = useDict ? best!.RefLow : row.RefLow;
            decimal? high = useDict ? best!.RefHigh : row.RefHigh;
            bool isNumber = decimal.TryParse(value,
                System.Globalization.NumberStyles.Any,
                System.Globalization.CultureInfo.InvariantCulture, out var num);
            work.Add((row, best, value, low, high, isNumber, num));
            if (best is not null && isNumber)
            {
                var fi = factors.First(f => f.FactorID == best.FactorID);
                obs.Add(new LabObs(best.FactorCode, best.ShortCode, fi.NameEn, num, row.Unit, low, high));
            }
        }

        // What the rules found, told row by row: the verdict belongs next to the
        // number in the same table, not in a separate report the doctor may miss.
        var analysisByRow = new Dictionary<int, (string Text, string Level)>();
        // موتورِ ناسازگاری هرگز نباید حکمِ بازه را ببلعد؛ فقط بخشِ تناقض در
        // محافظ است و شکستِ احتمالی‌اش بی‌صدا کنار می‌رود.
        List<ConsistencyFinding> findings;
        try
        {
            findings = LabConsistencyChecker.Check(obs, null, null);
        }
        catch
        {
            findings = new();
        }
        for (int i = 0; i < work.Count; i++)
        {
            var w = work[i];
            var fi = w.Best is null ? null : factors.First(f => f.FactorID == w.Best!.FactorID);
            var id = new LabRowAnalyzer.RowIdentity(fi?.NameEn, fi?.NameFa, w.Best?.ShortCode, w.Best?.FactorCode);
            // معیارِ قضاوت، بازهٔ چاپ‌شدهٔ خودِ برگه است — همان که در جدولِ بازبینی
            // دیده می‌شود — نه بازهٔ دیکشنری.
            var verdict = LabRowAnalyzer.Analyze(id, w.Value, w.Row.RefLow, w.Row.RefHigh, findings, w.Row.Value);
            if (verdict.Text.Length > 0) analysisByRow[i] = verdict;
        }

        var items = new List<object>();
        for (int i = 0; i < work.Count; i++)
        {
            var (row, best, value, _, _, _, _) = work[i];
            // اگر FitScale ممیزِ اعشار را جابه‌جا کرد، این استنتاج است نه خواندنِ
            // مستقیم؛ ضریبِ اطمینان کمی پایین می‌آید تا در بررسی دیده شود.
            int confidence = row.Confidence;
            string confidenceNote = row.ConfidenceNote;
            if (value.Length > 0 && value != row.Value)
            {
                confidence = Math.Min(confidence <= 0 ? 82 : confidence, 82);
                confidenceNote = "ممیزِ اعشار از روی بازه تصحیح شد";
            }
            // Per-row verdict: contradiction first, then the plain range check.
            string analysis = "", analysisLevel = "";
            if (analysisByRow.TryGetValue(i, out var hit))
            {
                analysis = hit.Text;
                analysisLevel = hit.Level;
            }
            items.Add(new
            {
                name = row.Name,
                nameFa = (string?)null,
                section = row.Section,
                value,
                unit = row.Unit,
                refText = row.RefText,
                refLow = row.RefLow,
                refHigh = row.RefHigh,
                flag = (string?)null,
                confidence,
                confidenceNote,
                analysis,
                analysisLevel,
                suggested = row.Suggested,
                factorID = best?.FactorID,
                factorCode = best?.FactorCode,
                factorNameFa = best?.NameFa,
                factorShortCode = best?.ShortCode,
                factorUnit = best?.UnitUCUM,
                matchConfidence = best?.Confidence ?? 0,
                matchStatus = best is null ? "unmatched" : (best.Confidence >= 95 ? "matched" : "review")
            });
        }

        return Ok(new
        {
            success = true,
            imageID = (long?)null,
            extractionID = batch.ExtractionID,
            labName = (string?)null,
            sampleDateRaw = (string?)null,
            sampleDate = (DateTime?)null,
            unmatchedCount = unmatched,
            items
        });
    }

    private sealed record FactorInfo(int FactorID, string FactorCode, string NameFa, string NameEn, string? ShortCode, string? LoincCode, string? UnitUCUM, decimal? RefLow, decimal? RefHigh, byte DataType);
    private sealed record MatchResult(int FactorID, string FactorCode, string NameFa, string? ShortCode, string? UnitUCUM, int Confidence, decimal? RefLow, decimal? RefHigh);

    /// <summary>
    /// Tesseract loses some printed values (the sheets' oblique font), while a
    /// vision model reads them fine. Only the cells the OCR lost are asked for,
    /// only clearly legible answers are taken, and every AI-filled cell is marked
    /// as a suggestion: nothing enters the record without the doctor's
    /// confirmation on the review screen.
    /// </summary>
    private async Task SuggestMissingAsync(byte[] image, List<LabSheetParser.Row> rows, CancellationToken ct)
    {
        var missing = rows
            .Select((r, i) => (Row: r, Index: i))
            .Where(x => x.Row.Value.Length == 0 || x.Row.RefText.Length == 0)
            .ToList();
        if (missing.Count == 0 || _ai.ConfigurationError() is not null) return;

        string need = string.Join("\n", missing.Select((x, n) =>
            $"{n + 1}. {x.Row.Name} - value: {(x.Row.Value.Length > 0 ? x.Row.Value : "MISSING")}, reference: {(x.Row.RefText.Length > 0 ? x.Row.RefText : "MISSING")}"));
        string prompt = $$"""
This image shows result rows cropped from a printed laboratory report (or one full page of it). The rows below are already located on the sheet; some cells could not be read. Look at the image and read ONLY the missing cells, exactly as printed. Never guess: if a cell is not clearly legible, return null for it.
{{need}}
Return ONLY valid JSON with this exact shape:
{"rows":[{"i":1,"value":"string|null","refText":"string|null"}]}
- i: the row number from the list above
- value: the result exactly as printed (number or short text), without the unit
- refText: the reference interval exactly as printed
""";
        try
        {
            // مدل، تصویرِ بزرگِ کلِ صفحه را با وضوحِ کم می‌بیند و اعدادِ ریزِ
            // فونتِ مورب را گم می‌کند؛ ناحیهٔ همان ردیف‌ها بریده و همان فرستاده
            // می‌شود تا عدد درشت و خوانا باشد. برش‌های باریک هم ۲× بزرگ می‌شوند.
            byte[] payload = MagnifyForModel(CropRows(image, missing) ?? image);
            string raw = await _ai.CompleteJsonAsync(prompt,
                new List<(string Mime, byte[] Bytes)> { ("image/jpeg", payload) }, ct);
            using var doc = JsonDocument.Parse(raw);
            if (!doc.RootElement.TryGetProperty("rows", out var answer)) return;
            foreach (var el in answer.EnumerateArray())
            {
                if (!el.TryGetProperty("i", out var iEl) || !iEl.TryGetInt32(out int i)) continue;
                int idx = i - 1;
                if (idx < 0 || idx >= missing.Count) continue;
                var (row, rowIndex) = missing[idx];

                string? v = GetString(el, "value");
                if (row.Value.Length == 0 && !string.IsNullOrWhiteSpace(v))
                {
                    v = v.Trim();
                    if (v.Length is > 0 and <= 24)
                        row = row with
                        {
                            Value = v,
                            Suggested = true,
                            Confidence = 70,
                            ConfidenceNote = "پیشنهادِ هوش مصنوعی — قبل از ثبت تأیید کنید"
                        };
                }
                string? rt = GetString(el, "refText");
                if (row.RefText.Length == 0 && !string.IsNullOrWhiteSpace(rt))
                {
                    rt = rt.Trim();
                    if (rt.Length is > 0 and <= 60)
                    {
                        var (lo, hi) = LabSheetParser.ParseRef(rt);
                        row = row with { RefText = rt, RefLow = lo, RefHigh = hi, Suggested = true };
                    }
                }
                rows[rowIndex] = row;
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // پیشنهادِ AI اختیاری است؛ خطا یعنی همان سلول‌ها خالی می‌مانند.
        }
    }

    /// <summary>
    /// The paper snippet behind one extracted row. Trust in AI comes from being
    /// able to verify it: one click shows the exact band of the sheet the number
    /// was read from, beside the number itself.
    /// </summary>
    /// <summary>
    /// آزمایشاتِ این مراجعه. هر «آزمایش» یک گزارشِ آزمایشگاه است: یک یا چند
    /// صفحه که یکجا استخراج شده‌اند + فیلدهای استخراج‌شده‌اش (هموگلوبین و …).
    /// آزمایش مثلِ تصویرِ رادیولوژی یک «سندِ» پیوست‌شده به مراجعه است — نه
    /// اقدام، نه مالی، و هیچ ارتباطی بینِ آزمایش و اقدام نیست.
    /// </summary>
    [HttpGet("lab-tests")]
    public async Task<IActionResult> LabTests([FromQuery] int studyID, CancellationToken cancellationToken)
    {
        if (studyID <= 0) return BadRequest(new { success = false, message = "شمارهٔ مراجعه درست نیست." });

        var batches = await _db.LabReportExtractions.AsNoTracking()
            .Where(x => x.StudyID == studyID)
            .OrderBy(x => x.CreatedDate)
            .ToListAsync(cancellationToken);

        var tests = batches.Select(b =>
        {
            List<LabSheetParser.Row> rows = new();
            try { rows = JsonSerializer.Deserialize<List<LabSheetParser.Row>>(b.RawJson ?? "[]") ?? new(); }
            catch { rows = new(); }
            return new
            {
                extractionID = b.ExtractionID,
                labName = b.LabName,
                sampleDate = b.SampleDate,
                createdDate = b.CreatedDate,
                status = b.Status,
                pageCount = (b.ImagePath ?? "").Split('|', StringSplitOptions.RemoveEmptyEntries).Length,
                fields = rows.Select((r, i) => new
                {
                    row = i,
                    name = r.Name,
                    value = r.Value,
                    unit = r.Unit,
                    refText = r.RefText,
                    refLow = r.RefLow,
                    refHigh = r.RefHigh,
                    confidence = r.Confidence,
                    section = r.Section
                }).Where(x => !string.IsNullOrWhiteSpace(x.name) && !string.IsNullOrWhiteSpace(x.value)).ToList()
            };
        }).ToList();

        return Ok(new { success = true, tests });
    }

    [HttpGet("crop")]
    public async Task<IActionResult> Crop([FromQuery] long extractionID, [FromQuery] int row,
        CancellationToken cancellationToken)
    {
        var batch = await _db.LabReportExtractions.AsNoTracking()
            .FirstOrDefaultAsync(x => x.ExtractionID == extractionID, cancellationToken);
        if (batch is null) return NotFound();

        List<LabSheetParser.Row>? rows = null;
        try { rows = JsonSerializer.Deserialize<List<LabSheetParser.Row>>(batch.RawJson ?? "[]"); }
        catch (JsonException) { }
        if (rows is null || row < 0 || row >= rows.Count) return NotFound();

        string? imagePath = PageImagePath(batch, rows[row]);
        if (imagePath is null) return NotFound();
        byte[] image = await System.IO.File.ReadAllBytesAsync(imagePath, cancellationToken);
        // مختصاتِ ردیف‌ها روی تصویرِ راست‌شده است؛ اول همان نسخه ساخته می‌شود
        // وگرنه برش جایِ دیگری از برگه را نشان می‌دهد.
        image = await _ai.UprightAsync(image, cancellationToken);
        byte[]? jpeg = CropRows(image, new List<(LabSheetParser.Row Row, int Index)> { (rows[row], row) });
        return jpeg is null ? NotFound() : File(jpeg, "image/jpeg");
    }

    public sealed class RereadRequest
    {
        public long ExtractionID { get; set; }
        public int Row { get; set; }
    }

    /// <summary>
    /// Re-reads ONE row's snippet - the exact band of paper shown to the doctor -
    /// instead of the whole sheet. The deterministic OCR runs on the crop first;
    /// if a cell stays unreadable the vision model reads just that crop. Trust but
    /// verify, and when verification fails, fix the spot without redoing the work.
    /// </summary>
    [HttpPost("reread")]
    public async Task<IActionResult> Reread(RereadRequest request, CancellationToken cancellationToken)
    {
        var batch = await _db.LabReportExtractions.AsNoTracking()
            .FirstOrDefaultAsync(x => x.ExtractionID == request.ExtractionID, cancellationToken);
        if (batch is null) return NotFound(new { success = false, message = "برگه پیدا نشد." });

        List<LabSheetParser.Row>? rows = null;
        try { rows = JsonSerializer.Deserialize<List<LabSheetParser.Row>>(batch.RawJson ?? "[]"); }
        catch (JsonException) { }
        if (rows is null || request.Row < 0 || request.Row >= rows.Count)
            return NotFound(new { success = false, message = "ردیف پیدا نشد." });
        var original = rows[request.Row];

        string? imagePath = PageImagePath(batch, original);
        if (imagePath is null) return NotFound(new { success = false, message = "تصویرِ این صفحه ذخیره نشده است." });
        byte[] image = await System.IO.File.ReadAllBytesAsync(imagePath, cancellationToken);
        // مختصاتِ ردیف‌ها روی تصویرِ راست‌شده است؛ برش باید از همان نسخه باشد.
        image = await _ai.UprightAsync(image, cancellationToken);
        byte[] crop = CropRows(image, new List<(LabSheetParser.Row Row, int Index)> { (original, request.Row) }) ?? image;

        // OCR قطعی روی خودِ همان تکه.
        string tsv = await _ai.OcrTsvAsync(crop, cancellationToken);
        var fresh = LabSheetParser.ParseTsv(tsv);
        string n0 = Norm(original.Name);
        var pick = fresh.FirstOrDefault(r => Norm(r.Name) == n0)
            ?? fresh.Where(r => n0.Length > 0 && (Norm(r.Name).Contains(n0) || n0.Contains(Norm(r.Name))))
                .OrderByDescending(r => r.Value.Length).FirstOrDefault();

        if (pick is null)
            return Ok(new
            {
                success = true,
                name = original.Name,
                value = original.Value,
                unit = original.Unit,
                refText = original.RefText,
                suggested = original.Suggested,
                note = "این ناحیه دوباره خوانده شد ولی چیزِ تازه‌ای پیدا نشد؛ مقادیرِ قبلی حفظ شد."
            });

        // اگر مقدار هنوز خالی است، فقط همین تکه را مدلِ بینایی ببیند.
        if (pick.Value.Length == 0)
        {
            var one = new List<LabSheetParser.Row> { pick };
            await SuggestMissingAsync(crop, one, cancellationToken);
            pick = one[0];
        }

        return Ok(new
        {
            success = true,
            name = pick.Name,
            value = pick.Value,
            unit = pick.Unit,
            refText = pick.RefText,
            suggested = pick.Suggested
        });
    }

    /// <summary>
    /// فایلِ صفحه‌ای که این ردیف از آن خوانده شده: استخراج می‌تواند چند صفحه
    /// باشد و مختصاتِ هر ردیف فقط با صفحهٔ خودش می‌خواند.
    /// </summary>
    private string? PageImagePath(LabReportExtraction batch, LabSheetParser.Row row)
    {
        var paths = (batch.ImagePath ?? "").Split('|', StringSplitOptions.RemoveEmptyEntries);
        if (paths.Length == 0) return null;
        string path = row.Page >= 0 && row.Page < paths.Length ? paths[row.Page] : paths[0];
        return System.IO.File.Exists(path) ? path : null;
    }

    /// <summary>
    /// برش‌های باریک (یک ردیف) برایِ مدل خیلی کوچک‌اند: با کوچک‌نماییِ داخلیِ
    /// مدل، عدد ناخوانا می‌شود. ۲× بزرگ می‌شوند تا عدد درشت بماند.
    /// </summary>
    private static byte[] MagnifyForModel(byte[] jpeg)
    {
        return ImageOps.Magnify(jpeg) ?? jpeg;
    }

    /// <summary>
    /// نوارِ ردیف‌های گم‌شده که روی هم چیده شده‌اند: مدل باید عدد را درشت و
    /// خوانا ببیند، نه اینکه در عکسِ بزرگِ کلِ صفحه دنبالش بگردد.
    /// </summary>
    private static byte[]? CropRows(byte[] image, List<(LabSheetParser.Row Row, int Index)> missing)
    {
        try
        {
            var bands = new List<(int Top, int Bottom)>();
            foreach (var x in missing)
            {
                if (x.Row.PixelTop < 0 || x.Row.PixelHeight <= 0) return null;
                int top = Math.Max(0, x.Row.PixelTop - 30);
                int bottom = Math.Min(int.MaxValue, x.Row.PixelTop + x.Row.PixelHeight + 30);
                bands.Add((top, bottom));
            }
            return ImageOps.CropBands(image, bands);
        }
        catch { return null; }
    }

    /// <summary>A printed result that is words, not a number ("Trace", "Negative").</summary>
    private static bool LooksQualitative(string? value)
    {
        string v = (value ?? string.Empty).Trim();
        return v.Length > 0 && !char.IsDigit(v[0]) && v[0] != '<' && v[0] != '>' && v[0] != '-';
    }

    /// <summary>
    /// Name matching between what the lab printed and our dictionary. Confidence
    /// drops from an exact name/alias hit to a partial one; below the threshold the
    /// row is returned unmatched so a human maps it by hand. A qualitative result
    /// never maps to a numeric factor: "Trace" for urine protein is not the serum
    /// total protein number.
    /// </summary>
    private static MatchResult? MatchFactor(string printedName, List<FactorInfo> factors, bool qualitative = false)
    {
        string n = Norm(printedName);
        if (n.Length == 0) return null;

        MatchResult? best = null;
        foreach (var f in factors)
        {
            if (qualitative && f.DataType == 1) continue;
            int score;
            int dot = f.FactorCode.LastIndexOf('.');
            string codeTail = Norm(dot >= 0 ? f.FactorCode[(dot + 1)..] : f.FactorCode);

            if (n == Norm(f.NameEn) || n == Norm(f.NameFa) || n == codeTail
                || (!string.IsNullOrEmpty(f.ShortCode) && n == Norm(f.ShortCode))) score = 100;
            else if (!string.IsNullOrEmpty(f.LoincCode) && n == Norm(f.LoincCode)) score = 100;
            else
            {
                // Containment only for near-length names: "NEU" inside
                // "Neurologic exam" is not a match - a lab sheet never maps to an
                // examination factor.
                string en = Norm(f.NameEn);
                int min = Math.Min(en.Length, n.Length);
                int max = Math.Max(en.Length, n.Length);
                score = min >= 5 && min * 2 >= max && (n.Contains(en) || en.Contains(n)) ? 80 : 0;
            }

            if (score >= 80 && (best is null || score > best.Confidence))
                best = new MatchResult(f.FactorID, f.FactorCode, f.NameFa, f.ShortCode, f.UnitUCUM, score, f.RefLow, f.RefHigh);
        }
        return best;
    }

    /// <summary>Normalizes a printed name so spelling variants line up.</summary>
    private static string Norm(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return string.Empty;
        string s = raw.Trim().ToLowerInvariant()
            .Replace('ي', 'ی').Replace('ك', 'ک').Replace("\u200c", string.Empty);
        var sb = new System.Text.StringBuilder(s.Length);
        foreach (char c in s)
            if (char.IsLetterOrDigit(c)) sb.Append(c);
        return sb.ToString();
    }

    private static string? GetString(JsonElement el, string name)
    {
        if (!el.TryGetProperty(name, out var v) || v.ValueKind == JsonValueKind.Null) return null;
        string? s = v.ValueKind == JsonValueKind.String ? v.GetString() : v.ToString();
        return string.IsNullOrWhiteSpace(s) ? null : s.Trim();
    }

    private static decimal? GetDecimal(JsonElement el, string name)
    {
        if (!el.TryGetProperty(name, out var v) || v.ValueKind == JsonValueKind.Null) return null;
        if (v.ValueKind == JsonValueKind.Number && v.TryGetDecimal(out var d)) return d;
        if (v.ValueKind == JsonValueKind.String && decimal.TryParse(v.GetString(), out var parsed)) return parsed;
        return null;
    }

    private static DateTime? ParseDate(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return null;
        return DateTime.TryParse(raw, out var dt) ? dt : null;
    }
}
