using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.FileProviders;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using ReSiRai.Api.Controllers;
using ReSiRai.Api.Data;
using ReSiRai.Api.Models;
using ReSiRai.Api.Services;
using Xunit;

namespace ReSiRai.Tests;

/// <summary>
/// نگهبانِ مسیرِ «عکس با دوربین گوشی» از لینک/کیوآرکد عمومی:
/// توکنِ معتبر + Studyِ متعلق به همان بیمار لازم است، فقط JPEG/PNG می‌پذیریم،
/// عکسِ تکراری دوباره ثبت نمی‌شود و توکنِ منقضی/بدونِ Study رد می‌شود.
/// </summary>
public class PatientReceiveCameraTests : IDisposable
{
    private readonly ReSiRaiDbContext _db;
    private readonly PatientReceiveController _controller;
    private readonly string _root;

    public PatientReceiveCameraTests()
    {
        _root = Path.Combine(Path.GetTempPath(), "resirai-receive-" + Guid.NewGuid().ToString("N"));
        _db = new ReSiRaiDbContext(new DbContextOptionsBuilder<ReSiRaiDbContext>()
            .UseInMemoryDatabase(Guid.NewGuid().ToString()).Options);

        var storage = new RadiologyStorageService(Options.Create(new RadiologyStorageOptions { RootPath = _root }));
        var inbox = new SmsInboxService(_db, new StubHttpClientFactory(), storage, NullLogger<SmsInboxService>.Instance);
        var config = new ConfigurationBuilder().Build();
        _controller = new PatientReceiveController(
            _db, inbox, new StubEnvironment(), config, new AppEventLogger(_db));
    }

    public void Dispose()
    {
        try { if (Directory.Exists(_root)) Directory.Delete(_root, true); } catch { }
    }

    [Fact]
    public async Task Upload_WithValidToken_AttachesPhotoToStudy()
    {
        var (token, studyID) = await AddPatientStudyAndToken();

        var result = await _controller.UploadFromCamera(token, Jpeg(), default);

        var ok = Assert.IsType<OkObjectResult>(result);
        var json = JsonSerializer.SerializeToElement(ok.Value);
        Assert.Equal("imported", json.GetProperty("outcome").GetString());
        Assert.Equal(studyID, json.GetProperty("studyID").GetInt32());
        Assert.Equal(1, _db.RadiologyImages.Count());
        Assert.Equal(1, _db.RadiologyStudyImages.Count());
        Assert.Equal(1, _db.PatientReceiveTokens.Single().UseCount);
    }

    [Fact]
    public async Task Upload_SamePhotoTwice_IsDuplicate()
    {
        var (token, _) = await AddPatientStudyAndToken();

        await _controller.UploadFromCamera(token, Jpeg(), default);
        var result = await _controller.UploadFromCamera(token, Jpeg(), default);

        var ok = Assert.IsType<OkObjectResult>(result);
        var json = JsonSerializer.SerializeToElement(ok.Value);
        Assert.Equal("duplicate", json.GetProperty("outcome").GetString());
        Assert.Equal(1, _db.RadiologyImages.Count());
    }

    [Fact]
    public async Task Upload_WhenTokenHasNoStudy_IsRejected()
    {
        var (token, _) = await AddPatientStudyAndToken(withStudy: false);

        var result = await _controller.UploadFromCamera(token, Jpeg(), default);

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(0, _db.RadiologyImages.Count());
    }

    [Fact]
    public async Task Upload_NonImageBytes_IsRejected()
    {
        var (token, _) = await AddPatientStudyAndToken();
        var bytes = System.Text.Encoding.UTF8.GetBytes("<html>not a photo</html>");
        var file = new FormFile(new MemoryStream(bytes), 0, bytes.Length, "file", "photo.jpg")
        {
            Headers = new HeaderDictionary(),
            ContentType = "image/jpeg"
        };

        var result = await _controller.UploadFromCamera(token, file, default);

        Assert.IsType<BadRequestObjectResult>(result);
        Assert.Equal(0, _db.RadiologyImages.Count());
    }

    [Fact]
    public async Task Upload_ExpiredToken_IsRejected()
    {
        var (token, _) = await AddPatientStudyAndToken(expired: true);

        var result = await _controller.UploadFromCamera(token, Jpeg(), default);

        Assert.IsType<NotFoundObjectResult>(result);
        Assert.Equal(0, _db.RadiologyImages.Count());
    }

    // ------------------------------------------------------------------
    private async Task<(string Token, int StudyID)> AddPatientStudyAndToken(
        bool withStudy = true, bool expired = false)
    {
        var patient = new Patient
        {
            NationalCode = "0012345678",
            FirstName = "سارا",
            LastName = "آزمایشی",
            IsActive = true,
            CreatedDate = DateTime.Now
        };
        _db.Patients.Add(patient);

        var type = new StudyType { StudyTypeName = "رادیولوژی", IsActive = true };
        _db.StudyTypes.Add(type);
        await _db.SaveChangesAsync();

        var study = new RadiologyStudy
        {
            PatientID = patient.PatientID,
            StudyTypeID = type.StudyTypeID,
            StudyDate = DateTime.Now,
            CreatedDate = DateTime.Now,
            Status = 1
        };
        _db.RadiologyStudies.Add(study);
        await _db.SaveChangesAsync();

        var token = new PatientReceiveToken
        {
            PatientID = patient.PatientID,
            StudyID = withStudy ? study.StudyID : null,
            Token = "tok-" + Guid.NewGuid().ToString("N"),
            CreatedDate = DateTime.Now.AddMinutes(expired ? -10 : 0),
            ExpiresDate = DateTime.Now.AddMinutes(expired ? -5 : 60)
        };
        _db.PatientReceiveTokens.Add(token);
        await _db.SaveChangesAsync();

        return (token.Token, study.StudyID);
    }

    private static IFormFile Jpeg()
    {
        var bytes = new byte[] { 0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01 };
        return new FormFile(new MemoryStream(bytes), 0, bytes.Length, "file", "photo.jpg")
        {
            Headers = new HeaderDictionary(),
            ContentType = "image/jpeg"
        };
    }

    private sealed class StubHttpClientFactory : IHttpClientFactory
    {
        public HttpClient CreateClient(string name) => new();
    }

    private sealed class StubEnvironment : IWebHostEnvironment
    {
        public string ApplicationName { get; set; } = "ReSiRai.Tests";
        public IFileProvider WebRootFileProvider { get; set; } = new NullFileProvider();
        public string WebRootPath { get; set; } = string.Empty;
        public string EnvironmentName { get; set; } = "Development";
        public string ContentRootPath { get; set; } = Directory.GetCurrentDirectory();
        public IFileProvider ContentRootFileProvider { get; set; } = new NullFileProvider();
    }
}
