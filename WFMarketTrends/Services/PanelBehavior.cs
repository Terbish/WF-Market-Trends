using System;
using WFMarketTrends.Models;

namespace WFMarketTrends.Services;

internal static class PanelLayout
{
    public static (int X, int Width, int Height) Calculate(int left, int screenWidth, int screenHeight, double scale, AppSettings settings)
    {
        int width = Math.Min(screenWidth, (int)Math.Round(settings.PanelWidth * scale));
        int height = Math.Min(screenHeight, (int)Math.Round(settings.PanelHeight * scale));
        int offset = settings.Position switch { "Left" => 0, "Right" => screenWidth - width, _ => (screenWidth - width) / 2 };
        return (left + offset, width, height);
    }
}

internal sealed class PointerLeaveState
{
    private bool _entered;
    private bool _clickedInside;
    private int _revealVersion;

    public bool ShouldHide(int revealVersion, bool revealed, bool inside, bool animating, bool suspended, bool clicked = false)
    {
        if (_revealVersion != revealVersion || !revealed) _entered = _clickedInside = false;
        _revealVersion = revealVersion;
        if (!revealed) return false;
        _entered |= inside;
        _clickedInside |= clicked && inside;
        if (suspended || inside) return false;
        return _clickedInside ? clicked : _entered && !animating;
    }
}
