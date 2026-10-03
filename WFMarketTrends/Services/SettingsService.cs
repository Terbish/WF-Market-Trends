using System;
using System.IO;
using System.Text.Json;
using WFMarketTrends.Models;

namespace WFMarketTrends.Services;

public sealed class SettingsService
{
    public static string DataFolder =>
#if SMOKE_TEST
        Path.Combine(AppContext.BaseDirectory, "smoke-profile");
#else
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WFMarketTrends");
#endif
    private readonly string _path;
    public string? LoadWarning { get; private set; }
    public SettingsService(string? path = null) => _path = path ?? Path.Combine(DataFolder, "settings.json");
    public AppSettings Load()
    {
        try
        {
            if (!File.Exists(_path)) return new();
            var settings = JsonSerializer.Deserialize<AppSettings>(File.ReadAllText(_path)) ?? new();
            settings.PanelWidth = Clamp(settings.PanelWidth, 320, 3840, 520);
            settings.PanelHeight = Clamp(settings.PanelHeight, 360, 2160, 844);
            if (settings.Position is not ("Left" or "Middle" or "Right")) settings.Position = "Middle";
            return settings;
        }
        catch (Exception ex) when (ex is IOException or UnauthorizedAccessException or JsonException)
        { LoadWarning = "Saved settings could not be read. Using defaults. " + ex.Message; return new(); }
    }
    public void Save(AppSettings settings)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_path)!);
        File.WriteAllText(_path + ".tmp", JsonSerializer.Serialize(settings));
        File.Move(_path + ".tmp", _path, true);
    }
    public static double Clamp(double value, double min, double max, double fallback) => double.IsFinite(value) ? Math.Clamp(value, min, max) : fallback;
}
