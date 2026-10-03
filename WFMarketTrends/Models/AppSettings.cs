namespace WFMarketTrends.Models;

public sealed class AppSettings
{
    public double PanelHeight { get; set; } = 844;
    public double PanelWidth { get; set; } = 520;
    public string Position { get; set; } = "Middle";
    public bool StartWithWindows { get; set; }
}
