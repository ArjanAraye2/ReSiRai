using System.Security.Cryptography;
using System.Text;

namespace ReSiRai.Api.Services;

/// <summary>
/// محدودیت ورود برای نصب تک‌سرور: ۳۰ درخواست از هر IP در ۱۰ دقیقه و
/// ۵ خطای حساب در ۱۰ دقیقه؛ هر دو برای ۱۵ دقیقه متوقف می‌شوند.
/// شمارنده‌ها در حافظه‌اند و با راه‌اندازی مجدد سرویس پاک می‌شوند.
/// </summary>
public sealed class LoginAttemptLimiter(TimeProvider clock)
{
    public const string Message = "تعداد تلاش‌های ورود بیش از حد مجاز است. لطفاً چند دقیقه بعد دوباره تلاش کنید.";
    private static readonly TimeSpan Window = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan BlockDuration = TimeSpan.FromMinutes(15);
    private readonly object _gate = new();
    private readonly Dictionary<string, Attempts> _ips = new(StringComparer.Ordinal);
    private readonly Dictionary<string, Attempts> _accounts = new(StringComparer.Ordinal);
    // Fixed stripes avoid keeping a semaphore for every submitted login name.
    private readonly SemaphoreSlim[] _accountLocks = Enumerable.Range(0, 256).Select(_ => new SemaphoreSlim(1, 1)).ToArray();
    private DateTimeOffset _nextCleanup;

    public static string AccountKey(int? userID, string identifier, bool superAdmin = false) =>
        superAdmin ? "superadmin" : userID.HasValue ? $"user:{userID.Value}" :
        "unknown:" + Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(identifier.Trim().ToUpperInvariant())));

    public async Task<IDisposable> AcquireAccountAsync(string key, CancellationToken cancellationToken)
    {
        var semaphore = _accountLocks[(int)((uint)StringComparer.Ordinal.GetHashCode(key) % (uint)_accountLocks.Length)];
        await semaphore.WaitAsync(cancellationToken);
        return new AccountLease(semaphore);
    }

    public LimitResult TryIpAttempt(string ip)
    {
        lock (_gate)
        {
            var now = clock.GetUtcNow();
            Cleanup(now);
            var state = Get(_ips, ip);
            Prepare(state, now);
            if (state.BlockedUntil > now) return Blocked(state, now);
            // Thirty requests are allowed; request 31 starts the temporary block.
            if (state.Times.Count >= 30) return StartBlock(state, now);
            state.Times.Enqueue(now);
            return default;
        }
    }

    public LimitResult CheckAccount(string key)
    {
        lock (_gate)
        {
            var now = clock.GetUtcNow();
            Cleanup(now);
            if (!_accounts.TryGetValue(key, out var state)) return default;
            Prepare(state, now);
            return state.BlockedUntil > now ? Blocked(state, now) : default;
        }
    }

    // The caller holds the account lease across checking, password verification
    // and recording its outcome, including requests from different IP addresses.
    public LimitResult RecordFailure(string key)
    {
        lock (_gate)
        {
            var now = clock.GetUtcNow();
            Cleanup(now);
            var state = Get(_accounts, key);
            Prepare(state, now);
            if (state.BlockedUntil > now) return Blocked(state, now);
            state.Times.Enqueue(now);
            return state.Times.Count >= 5 ? StartBlock(state, now, state.Times.Count) : new(false, 0, false, state.Times.Count);
        }
    }

    public void RecordSuccess(string key)
    {
        lock (_gate) _accounts.Remove(key);
    }

    private static Attempts Get(Dictionary<string, Attempts> states, string key)
    {
        if (!states.TryGetValue(key, out var state)) states[key] = state = new();
        return state;
    }

    private static void Prepare(Attempts state, DateTimeOffset now)
    {
        if (state.BlockedUntil != default && state.BlockedUntil <= now)
        {
            state.BlockedUntil = default;
            state.BlockedAttempts = 0;
            state.Times.Clear();
        }
        while (state.Times.TryPeek(out var time) && time <= now - Window) state.Times.Dequeue();
    }

    private static LimitResult StartBlock(Attempts state, DateTimeOffset now, int failedAttempts = 0)
    {
        state.BlockedUntil = now + BlockDuration;
        state.BlockedAttempts = failedAttempts;
        state.Times.Clear();
        return Blocked(state, now) with { IsNewBlock = true };
    }

    private static LimitResult Blocked(Attempts state, DateTimeOffset now) =>
        new(true, Math.Max(1, (int)Math.Ceiling((state.BlockedUntil - now).TotalSeconds)), false, state.BlockedAttempts);

    private void Cleanup(DateTimeOffset now)
    {
        if (now < _nextCleanup) return;
        _nextCleanup = now.AddMinutes(1);
        foreach (var states in new[] { _ips, _accounts })
        {
            foreach (var key in states.Keys.ToArray())
            {
                var state = states[key];
                Prepare(state, now);
                if (state.BlockedUntil <= now && state.Times.Count == 0) states.Remove(key);
            }
        }
    }

    public readonly record struct LimitResult(bool IsBlocked, int RetryAfterSeconds, bool IsNewBlock, int FailedAttempts = 0);
    private sealed class Attempts
    {
        public Queue<DateTimeOffset> Times { get; } = new();
        public DateTimeOffset BlockedUntil { get; set; }
        public int BlockedAttempts { get; set; }
    }
    private sealed class AccountLease(SemaphoreSlim semaphore) : IDisposable
    {
        private int _disposed;
        public void Dispose() { if (Interlocked.Exchange(ref _disposed, 1) == 0) semaphore.Release(); }
    }
}
