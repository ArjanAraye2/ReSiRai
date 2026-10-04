using ReSiRai.Api.Services;
using Xunit;

namespace ReSiRai.Tests;

public sealed class LoginAttemptLimiterTests
{
    [Fact]
    public void ReactionCountSurvivesAccountBlockButResetsAfterExpiry()
    {
        var clock = new TestClock();
        var limiter = new LoginAttemptLimiter(clock);
        for (int i = 1; i <= 5; i++) Assert.Equal(i, limiter.RecordFailure("account").FailedAttempts);
        Assert.Equal(5, limiter.CheckAccount("account").FailedAttempts);
        clock.Advance(TimeSpan.FromMinutes(15));
        Assert.Equal(0, limiter.CheckAccount("account").FailedAttempts);
        Assert.Equal(1, limiter.RecordFailure("account").FailedAttempts);
    }

    [Fact]
    public void IpAllowsThirtyAttemptsThenBlocksForFifteenMinutesWithoutExtension()
    {
        var clock = new TestClock();
        var limiter = new LoginAttemptLimiter(clock);
        for (int i = 0; i < 30; i++) Assert.False(limiter.TryIpAttempt("ip1").IsBlocked);
        var result = limiter.TryIpAttempt("ip1");
        Assert.True(result.IsNewBlock);
        Assert.Equal(900, result.RetryAfterSeconds);
        Assert.False(limiter.TryIpAttempt("ip2").IsBlocked);
        clock.Advance(TimeSpan.FromMinutes(10));
        result = limiter.TryIpAttempt("ip1");
        Assert.True(result.IsBlocked);
        Assert.False(result.IsNewBlock);
        Assert.Equal(300, result.RetryAfterSeconds);
        clock.Advance(TimeSpan.FromMinutes(5));
        Assert.False(limiter.TryIpAttempt("ip1").IsBlocked);
    }

    [Fact]
    public void IpUsesRollingTenMinuteWindow()
    {
        var clock = new TestClock();
        var limiter = new LoginAttemptLimiter(clock);
        for (int i = 0; i < 15; i++) limiter.TryIpAttempt("ip");
        clock.Advance(TimeSpan.FromMinutes(9));
        for (int i = 0; i < 15; i++) limiter.TryIpAttempt("ip");
        clock.Advance(TimeSpan.FromMinutes(1));
        Assert.False(limiter.TryIpAttempt("ip").IsBlocked);
    }

    [Fact]
    public void FifthAccountFailureBlocksAndExpiresEvenWhenRetrying()
    {
        var clock = new TestClock();
        var limiter = new LoginAttemptLimiter(clock);
        for (int i = 0; i < 4; i++) Assert.False(limiter.RecordFailure("user:1").IsBlocked);
        var result = limiter.RecordFailure("user:1");
        Assert.True(result.IsNewBlock);
        Assert.Equal(900, result.RetryAfterSeconds);
        Assert.False(limiter.CheckAccount("user:2").IsBlocked);
        clock.Advance(TimeSpan.FromMinutes(14));
        Assert.Equal(60, limiter.RecordFailure("user:1").RetryAfterSeconds);
        clock.Advance(TimeSpan.FromMinutes(1));
        Assert.False(limiter.CheckAccount("user:1").IsBlocked);
        Assert.False(limiter.RecordFailure("user:1").IsBlocked);
    }

    [Fact]
    public void SuccessResetsAccountFailuresButDoesNotResetIpAttempts()
    {
        var limiter = new LoginAttemptLimiter(new TestClock());
        for (int i = 0; i < 4; i++) limiter.RecordFailure("account");
        for (int i = 0; i < 30; i++) limiter.TryIpAttempt("ip");
        limiter.RecordSuccess("account");
        for (int i = 0; i < 4; i++) Assert.False(limiter.RecordFailure("account").IsBlocked);
        Assert.True(limiter.RecordFailure("account").IsBlocked);
        Assert.True(limiter.TryIpAttempt("ip").IsBlocked);
    }

    [Fact]
    public void OldAccountFailuresExpireAtTenMinutes()
    {
        var clock = new TestClock();
        var limiter = new LoginAttemptLimiter(clock);
        for (int i = 0; i < 4; i++) limiter.RecordFailure("account");
        clock.Advance(TimeSpan.FromMinutes(10));
        Assert.False(limiter.RecordFailure("account").IsBlocked);
    }

    [Fact]
    public void AccountAliasesShareKeyAndSuperAdminIsCaseIndependent()
    {
        Assert.Equal(LoginAttemptLimiter.AccountKey(42, "09123456789"), LoginAttemptLimiter.AccountKey(42, "1234567890"));
        Assert.Equal(LoginAttemptLimiter.AccountKey(null, "admin", true), LoginAttemptLimiter.AccountKey(null, "ADMIN", true));
        Assert.Equal(LoginAttemptLimiter.AccountKey(null, " missing "), LoginAttemptLimiter.AccountKey(null, "MISSING"));
        Assert.NotEqual(LoginAttemptLimiter.AccountKey(1, "id"), LoginAttemptLimiter.AccountKey(2, "id"));
    }

    [Fact]
    public async Task ConcurrentRequestsCannotPassAccountCheckBeforeRecordingFailures()
    {
        var limiter = new LoginAttemptLimiter(new TestClock());
        int verified = 0;
        await Task.WhenAll(Enumerable.Range(0, 20).Select(async _ =>
        {
            using var lease = await limiter.AcquireAccountAsync("account", CancellationToken.None);
            if (limiter.CheckAccount("account").IsBlocked) return;
            Interlocked.Increment(ref verified);
            await Task.Yield();
            limiter.RecordFailure("account");
        }));
        Assert.Equal(5, verified);
        Assert.True(limiter.CheckAccount("account").IsBlocked);
    }

    [Fact]
    public async Task CancelledAccountWaitDoesNotLeakOrReleaseAnotherRequestsLease()
    {
        var limiter = new LoginAttemptLimiter(new TestClock());
        var lease = await limiter.AcquireAccountAsync("account", CancellationToken.None);
        using var cancellation = new CancellationTokenSource();
        var pending = limiter.AcquireAccountAsync("account", cancellation.Token);
        cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => pending);
        lease.Dispose();
        lease.Dispose();
        using var next = await limiter.AcquireAccountAsync("account", CancellationToken.None);
    }

    [Fact]
    public void ConcurrentIpRequestsOnlyAdmitThirty()
    {
        var limiter = new LoginAttemptLimiter(new TestClock());
        int accepted = 0;
        Parallel.For(0, 100, _ => { if (!limiter.TryIpAttempt("ip").IsBlocked) Interlocked.Increment(ref accepted); });
        Assert.Equal(30, accepted);
    }

    public sealed class TestClock : TimeProvider
    {
        private DateTimeOffset _now = new(2026, 10, 4, 0, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => _now;
        public void Advance(TimeSpan duration) => _now += duration;
    }
}
