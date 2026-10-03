using System;
using System.IO;
using Microsoft.Win32;

namespace WFMarketTrends.Services;

internal static class StartupService
{
    private const string Key = @"Software\Microsoft\Windows\CurrentVersion\Run";
    public static void SetEnabled(bool enabled)
    {
        using var key = Registry.CurrentUser.CreateSubKey(Key, true);
        if (enabled)
        {
            string executable = Environment.ProcessPath ?? throw new IOException("Cannot locate WFMarketTrends.exe.");
            key.SetValue("WFMarketTrends", $"\"{executable}\" --startup");
        }
        else key.DeleteValue("WFMarketTrends", false);
    }
}
