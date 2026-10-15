using ReSiRai.Api.Data;
using ReSiRai.Api.Models;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using System.Net;
using System.Net.Sockets;

namespace ReSiRai.Api.Controllers
{
    // Read-only operational summary for the Dashboard. Patient and Study
    // commands deliberately remain in their dedicated workspaces.
    [ApiController]
    [Route("api/[controller]")]
    public class DashboardController : ControllerBase
    {
        private readonly ReSiRaiDbContext _context;
        private readonly IConfiguration _configuration;
        private readonly RadiologyStorageOptions _storageOptions;

        public DashboardController(ReSiRaiDbContext context, IConfiguration configuration, IOptions<RadiologyStorageOptions> storageOptions)
        {
            _context = context;
            _configuration = configuration;
            _storageOptions = storageOptions.Value;
        }

        [HttpGet]
        public async Task<IActionResult> GetDashboard()
        {
            DateTime today = DateTime.Today;
            DateTime tomorrow = today.AddDays(1);

            bool databaseConnected;
            // The connectivity probe is bounded: a misconfigured or unreachable
            // server can otherwise stall the dashboard for ~60s before failing.
            using (var probeTimeout = new CancellationTokenSource(TimeSpan.FromSeconds(5)))
            {
                try
                {
                    databaseConnected = await _context.Database.CanConnectAsync(probeTimeout.Token);
                }
                catch
                {
                    databaseConnected = false;
                }
            }

            int totalPatients = 0, activePatients = 0, totalStudies = 0, totalImages = 0;
            int newPatientsToday = 0, studiesToday = 0, patientsToday = 0, imagesToday = 0;
            int openStudies = 0, dueFollowUps = 0;
            List<object> recentStudies = new();
            List<object> recentImages = new();

            if (databaseConnected)
            {
                // A DbContext cannot run several commands concurrently, so the counts
                // are awaited sequentially. recentStudies/recentImages are plain
                // projections so they stay cheap.
                // پزشک فقط آمارِ خودش را می‌بیند: بیمارانی که برایشان مراجعه‌ای با
                // DoctorStaffID همین پزشک ثبت شده است (و مطالعاتِ همان پزشک).
                byte.TryParse(User.FindFirst("StaffType")?.Value, out byte dashStaffType);
                int.TryParse(User.FindFirst("StaffID")?.Value, out int dashStaffID);
                bool dashSuper = string.Equals(User.FindFirst("IsSuperAdmin")?.Value, "true", StringComparison.OrdinalIgnoreCase);
                bool dashIsDoctor = !dashSuper && dashStaffType == 2 && dashStaffID > 0;

                var studiesQ = _context.RadiologyStudies.AsNoTracking().AsQueryable();
                var patientsQ = _context.Patients.AsNoTracking().AsQueryable();
                if (dashIsDoctor)
                {
                    studiesQ = studiesQ.Where(s => s.DoctorStaffID == dashStaffID);
                    var myPatientIds = _context.RadiologyStudies.AsNoTracking()
                        .Where(s => s.DoctorStaffID == dashStaffID)
                        .Select(s => s.PatientID);
                    patientsQ = patientsQ.Where(p => myPatientIds.Contains(p.PatientID));
                }

                totalPatients = await patientsQ.CountAsync();
                activePatients = await patientsQ.CountAsync(p => p.IsActive);
                totalStudies = await studiesQ.CountAsync();
                totalImages = await _context.RadiologyImages.AsNoTracking().CountAsync();

                newPatientsToday = await patientsQ
                    .CountAsync(p => p.CreatedDate >= today && p.CreatedDate < tomorrow);
                studiesToday = await studiesQ
                    .CountAsync(s => s.StudyDate >= today && s.StudyDate < tomorrow);
                patientsToday = await studiesQ
                    .Where(s => s.StudyDate >= today && s.StudyDate < tomorrow)
                    .Select(s => s.PatientID).Distinct().CountAsync();
                imagesToday = await _context.RadiologyImages.AsNoTracking()
                    .CountAsync(i => i.CreatedDate >= today && i.CreatedDate < tomorrow);

                // Outstanding work: a Study still open, or a follow-up that has come due.
                openStudies = await _context.RadiologyStudies.AsNoTracking()
                    .CountAsync(s => s.Status != 2);
                dueFollowUps = await _context.RadiologyStudies.AsNoTracking()
                    .CountAsync(s => s.Status == 3 && s.FollowUpDate != null && s.FollowUpDate <= today);

                recentStudies = await (
                    from study in _context.RadiologyStudies.AsNoTracking()
                    join patient in _context.Patients.AsNoTracking() on study.PatientID equals patient.PatientID
                    join type in _context.StudyTypes.AsNoTracking() on study.StudyTypeID equals type.StudyTypeID
                    orderby study.StudyDate descending
                    select (object)new
                    {
                        study.StudyID, study.PatientID, study.StudyDate,
                        PatientName = patient.FirstName + " " + patient.LastName,
                        type.StudyTypeName,
                        study.BodyPart,
                        // Thumbnail shown on the dashboard: latest image of the study
                        // that has an actual picture (PDFs are ignored; the UI shows
                        // the study icon for them instead).
                        ThumbnailImageID = _context.RadiologyStudyImages.AsNoTracking()
                            .Where(link => link.StudyID == study.StudyID)
                            .Join(_context.RadiologyImages.AsNoTracking(),
                                link => link.ImageID, image => image.ImageID,
                                (link, image) => image)
                            .Where(image => image.ContentType != "application/pdf")
                            .OrderByDescending(image => image.CreatedDate)
                            .Select(image => (long?)image.ImageID)
                            .FirstOrDefault()
                    }).Take(5).ToListAsync();

                recentImages = await (
                    from image in _context.RadiologyImages.AsNoTracking()
                    join patient in _context.Patients.AsNoTracking() on image.PatientID equals patient.PatientID
                    join imageType in _context.ImageTypes.AsNoTracking() on image.ImageTypeID equals imageType.ImageTypeID into types
                    from imageType in types.DefaultIfEmpty()
                    orderby image.CreatedDate descending
                    select (object)new
                    {
                        image.ImageID, image.PatientID, image.FileName, image.ContentType, image.CreatedDate,
                        PatientName = patient.FirstName + " " + patient.LastName,
                        ImageTypeName = imageType == null ? null : imageType.ImageTypeName
                    }).Take(5).ToListAsync();
            }

            // The storage root is configured through RadiologyStorage:RootPath.
            // Reading it here (instead of a hard-coded D:\RadiologyData) keeps the
            // dashboard in sync with the path that actually stores the images.
            object storage;
            try
            {
                string rootPath = _storageOptions.RootPath;
                if (string.IsNullOrWhiteSpace(rootPath))
                {
                    storage = new { available = false, rootPath = (string?)null, freeBytes = (long?)null, totalBytes = (long?)null };
                }
                else
                {
                    string fullPath = Path.GetFullPath(rootPath);
                    string? pathRoot = Path.GetPathRoot(fullPath);
                    DriveInfo? drive = string.IsNullOrWhiteSpace(pathRoot) ? null : new DriveInfo(pathRoot);
                    bool driveReady = drive?.IsReady ?? false;
                    storage = new
                    {
                        available = driveReady && Directory.Exists(fullPath),
                        rootPath = fullPath,
                        freeBytes = driveReady ? drive!.AvailableFreeSpace : (long?)null,
                        totalBytes = driveReady ? drive!.TotalSize : (long?)null
                    };
                }
            }
            catch
            {
                storage = new { available = false, rootPath = _storageOptions.RootPath, freeBytes = (long?)null, totalBytes = (long?)null };
            }

            // LAN addresses are discovered locally and never require an Internet service.
            // A public/static address cannot be guessed safely, so it is read from the
            // optional RemoteAccess:PublicHost setting in ReSiRai.config.json.
            string scheme = _configuration["RemoteAccess:LocalScheme"]?.Trim() ?? "http";
            int port = _configuration.GetValue<int?>("RemoteAccess:LocalPort") ?? Request.Host.Port ?? 5202;
            string hostName = Dns.GetHostName();
            string[] localIps;
            try
            {
                localIps = Dns.GetHostAddresses(hostName)
                    .Where(address => address.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(address))
                    .Select(address => address.ToString()).Distinct().OrderBy(address => address).ToArray();
            }
            catch (SocketException)
            {
                localIps = Array.Empty<string>();
            }
            var localUrls = localIps.Select(address => $"{scheme}://{address}:{port}").ToArray();
            string serverNameUrl = $"{scheme}://{hostName}:{port}";
            string? publicHost = _configuration["RemoteAccess:PublicHost"]?.Trim();
            string publicScheme = _configuration["RemoteAccess:PublicScheme"]?.Trim() ?? "http";
            int publicPort = _configuration.GetValue<int?>("RemoteAccess:PublicPort") ?? port;
            string? publicUrl = string.IsNullOrWhiteSpace(publicHost)
                ? null
                : $"{publicScheme}://{publicHost}{((publicScheme == "http" && publicPort == 80) || (publicScheme == "https" && publicPort == 443) ? "" : $":{publicPort}")}";
            var network = new
            {
                hostName,
                localIps,
                localUrls,
                serverNameUrl,
                currentUrl = $"{Request.Scheme}://{Request.Host}",
                publicHost,
                publicUrl,
                publicConfigured = !string.IsNullOrWhiteSpace(publicHost),
                note = "برای دسترسی از دستگاه دیگر، آن دستگاه باید در همان شبکه باشد و پورت برنامه در Firewall باز باشد."
            };

            return Ok(new
            {
                success = true,
                generatedAt = DateTime.Now,
                overall = new
                {
                    totalPatients,
                    activePatients,
                    inactivePatients = totalPatients - activePatients,
                    totalStudies,
                    totalImages,
                    openStudies,
                    dueFollowUps
                },
                today = new { patientsToday, studiesToday, imagesToday, newPatientsToday },
                recentStudies,
                recentImages,
                system = new { databaseConnected, storage, network }
            });
        }
    }
}
