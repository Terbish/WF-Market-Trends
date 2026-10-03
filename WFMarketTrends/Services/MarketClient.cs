using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

namespace WFMarketTrends.Services;

// All networking stays in the host: fixed routes, identifiable traffic, no browser CORS workaround.
public sealed class MarketClient : IDisposable
{
    private readonly HttpClient _http = new() { BaseAddress = new Uri("https://api.warframe.market/v2/"), Timeout = TimeSpan.FromSeconds(25) };
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly CancellationTokenSource _lifetime = new();
    private DateTimeOffset _nextRequest;
    private JsonElement? _items;
    private CancellationTokenSource? _feed;
    private sealed record StatisticsCache(DateTimeOffset FetchedAt, JsonElement Data);
    public MarketClient() => _http.DefaultRequestHeaders.UserAgent.ParseAdd("WFMarketTrends/0.1.0");
    public static bool ValidPlatform(string platform) => platform is "pc" or "ps4" or "xbox" or "switch" or "mobile";
    public async Task<JsonElement> GetAsync(string kind, string? slug, string platform, bool crossplay)
    {
        if (!ValidPlatform(platform)) throw new ArgumentException("Unknown platform.");
        if (kind == "items" && _items.HasValue) return _items.Value;
        if (kind != "items" && (kind is not ("orders" or "statistics") || slug == null || !Regex.IsMatch(slug, "^[a-z0-9_]{1,160}$")))
            throw new ArgumentException("Unknown market request.");
        await _gate.WaitAsync(_lifetime.Token);
        try
        {
            if (kind == "items" && _items.HasValue) return _items.Value;
            string? cachePath = kind == "statistics" ? Path.Combine(SettingsService.DataFolder, "history-cache", platform, slug + ".json") : null;
            if (cachePath != null)
            {
                try
                {
                    if (File.Exists(cachePath))
                    {
                        var cached = JsonSerializer.Deserialize<StatisticsCache>(File.ReadAllText(cachePath));
                        if (cached != null && cached.FetchedAt <= DateTimeOffset.UtcNow && DateTimeOffset.UtcNow - cached.FetchedAt < TimeSpan.FromHours(1)) return cached.Data;
                    }
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException) { }
            }
            var delay = _nextRequest - DateTimeOffset.UtcNow;
            if (delay > TimeSpan.Zero) await Task.Delay(delay, _lifetime.Token);
            string route = kind == "statistics" ? "https://api.warframe.market/v1/items/" + slug + "/statistics" : kind == "items" ? "items" : "orders/item/" + slug;
            using var request = new HttpRequestMessage(HttpMethod.Get, route);
            request.Headers.Add("Language", "en"); request.Headers.Add("Platform", platform);
            if (kind != "statistics") request.Headers.Add("Crossplay", platform != "switch" && crossplay ? "true" : "false");
            _nextRequest = DateTimeOffset.UtcNow.AddMilliseconds(500); // Max 2 requests/sec across the app.
            using var response = await _http.SendAsync(request, _lifetime.Token);
            if (response.StatusCode == HttpStatusCode.TooManyRequests || (int)response.StatusCode == 509)
            {
                _nextRequest = response.Headers.RetryAfter?.Date ?? DateTimeOffset.UtcNow + (response.Headers.RetryAfter?.Delta ?? TimeSpan.FromSeconds(30));
                if (_nextRequest < DateTimeOffset.UtcNow.AddSeconds(1)) _nextRequest = DateTimeOffset.UtcNow.AddSeconds(1);
                throw new HttpRequestException("Market rate limit reached. Wait before refreshing.");
            }
            response.EnsureSuccessStatusCode();
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync(_lifetime.Token));
            if (!document.RootElement.TryGetProperty(kind == "statistics" ? "payload" : "data", out var data) || data.ValueKind == JsonValueKind.Null)
                throw new HttpRequestException("Market returned no data.");
            var result = data.Clone();
            if (kind == "items") _items = result;
            if (cachePath != null)
            {
                try
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(cachePath)!);
                    File.WriteAllText(cachePath + ".tmp", JsonSerializer.Serialize(new StatisticsCache(DateTimeOffset.UtcNow, result)));
                    File.Move(cachePath + ".tmp", cachePath, true);
                }
                catch (Exception ex) when (ex is IOException or UnauthorizedAccessException) { }
            }
            return result;
        }
        finally { _gate.Release(); }
    }
    public void StartFeed(string platform, bool crossplay, Action<object> send)
    {
        if (!ValidPlatform(platform)) throw new ArgumentException("Unknown platform.");
        _feed?.Cancel();
        var source = CancellationTokenSource.CreateLinkedTokenSource(_lifetime.Token);
        _feed = source;
        _ = RunFeedAsync(platform, platform != "switch" && crossplay, send, source);
    }
    private static async Task RunFeedAsync(string platform, bool crossplay, Action<object> send, CancellationTokenSource source)
    {
        var token = source.Token;
        int backoff = 2;
        try
        {
            while (!token.IsCancellationRequested)
            {
                try
                {
                    send(new { type = "feedStatus", status = "connecting", platform, crossplay });
                    using var socket = new ClientWebSocket();
                    socket.Options.AddSubProtocol("wfm");
                    socket.Options.SetRequestHeader("User-Agent", "WFMarketTrends/0.1.0");
                    socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
                    socket.Options.KeepAliveTimeout = TimeSpan.FromSeconds(20);
                    using var connection = CancellationTokenSource.CreateLinkedTokenSource(token);
                    connection.CancelAfter(TimeSpan.FromSeconds(25));
                    await socket.ConnectAsync(new Uri("wss://ws.warframe.market/socket"), connection.Token);
                    var subscription = JsonSerializer.SerializeToUtf8Bytes(new { route = "@wfm|cmd/subscribe/newOrders", id = "new-orders", payload = new { platform, crossplay } });
                    await socket.SendAsync(new ArraySegment<byte>(subscription), WebSocketMessageType.Text, true, token);
                    var buffer = new byte[8192];
                    while (socket.State == WebSocketState.Open && !token.IsCancellationRequested)
                    {
                        using var message = new MemoryStream();
                        WebSocketReceiveResult received;
                        do
                        {
                            received = await socket.ReceiveAsync(new ArraySegment<byte>(buffer), token);
                            if (received.MessageType == WebSocketMessageType.Close) throw new IOException("Market closed the connection.");
                            message.Write(buffer, 0, received.Count);
                            if (message.Length > 1024 * 1024) throw new IOException("Feed message too large.");
                        } while (!received.EndOfMessage);
                        using var doc = JsonDocument.Parse(message.ToArray());
                        string? route = doc.RootElement.GetProperty("route").GetString();
                        if (route == "@wfm|cmd/subscribe/newOrders:ok")
                        { backoff = 2; send(new { type = "feedStatus", status = "live", platform, crossplay }); }
                        else if (route == "@wfm|event/subscriptions/newOrder")
                            send(new { type = "newOrder", data = doc.RootElement.GetProperty("payload").Clone(), platform, crossplay });
                        else if (route?.Contains("error", StringComparison.OrdinalIgnoreCase) == true)
                            throw new IOException("Market rejected the subscription: " + doc.RootElement.ToString());
                    }
                }
                catch (Exception ex) when (!token.IsCancellationRequested)
                { send(new { type = "feedStatus", status = "reconnecting", detail = ex.Message, platform, crossplay }); }
                await Task.Delay(TimeSpan.FromSeconds(backoff), token);
                backoff = Math.Min(60, backoff * 2);
            }
        }
        catch (OperationCanceledException) when (token.IsCancellationRequested) { }
        finally { source.Dispose(); }
    }
    public void Dispose() { _lifetime.Cancel(); _http.Dispose(); }
}
