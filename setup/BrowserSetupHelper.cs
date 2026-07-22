using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Windows.Forms;
using Microsoft.Win32;

namespace MangaLensTRSetupHelper
{
    internal sealed class BrowserInfo
    {
        public string Name { get; private set; }
        public string ExeName { get; private set; }
        public string ExtensionsUrl { get; private set; }
        public string DownloadUrl { get; private set; }
        public string[] CandidatePaths { get; private set; }
        public string ExecutablePath { get; set; }

        public BrowserInfo(string name, string exeName, string extensionsUrl, string downloadUrl, params string[] candidatePaths)
        {
            Name = name;
            ExeName = exeName;
            ExtensionsUrl = extensionsUrl;
            DownloadUrl = downloadUrl;
            CandidatePaths = candidatePaths;
        }
    }

    internal static class Program
    {
        private static readonly string ExtensionPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Extension");

        [STAThread]
        private static int Main(string[] args)
        {
            if (args.Length > 0 && string.Equals(args[0], "--self-test", StringComparison.OrdinalIgnoreCase))
            {
                string testPath = args.Length > 1 ? args[1] : ExtensionPath;
                return RunSelfTest(testPath);
            }

            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupHelperForm());
            return 0;
        }

        private static int RunSelfTest(string extensionPath)
        {
            try
            {
                if (!File.Exists(Path.Combine(extensionPath, "manifest.json")))
                    return 2;

                List<BrowserInfo> browsers = CreateBrowserList();
                if (browsers.Count != 5 || browsers.Any(b => string.IsNullOrWhiteSpace(b.ExtensionsUrl)))
                    return 3;

                return 0;
            }
            catch
            {
                return 1;
            }
        }

        internal static List<BrowserInfo> CreateBrowserList()
        {
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            string programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);

            return new List<BrowserInfo>
            {
                new BrowserInfo("Google Chrome", "chrome.exe", "chrome://extensions/", "https://www.google.com/chrome/",
                    Path.Combine(local, "Google", "Chrome", "Application", "chrome.exe"),
                    Path.Combine(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
                    Path.Combine(programFilesX86, "Google", "Chrome", "Application", "chrome.exe")),
                new BrowserInfo("Microsoft Edge", "msedge.exe", "edge://extensions/", "https://www.microsoft.com/edge/download",
                    Path.Combine(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
                    Path.Combine(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe")),
                new BrowserInfo("Brave", "brave.exe", "brave://extensions/", "https://brave.com/download/",
                    Path.Combine(local, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
                    Path.Combine(programFiles, "BraveSoftware", "Brave-Browser", "Application", "brave.exe"),
                    Path.Combine(programFilesX86, "BraveSoftware", "Brave-Browser", "Application", "brave.exe")),
                new BrowserInfo("Vivaldi", "vivaldi.exe", "vivaldi://extensions/", "https://vivaldi.com/download/",
                    Path.Combine(local, "Vivaldi", "Application", "vivaldi.exe"),
                    Path.Combine(programFiles, "Vivaldi", "Application", "vivaldi.exe"),
                    Path.Combine(programFilesX86, "Vivaldi", "Application", "vivaldi.exe")),
                new BrowserInfo("Opera", "opera.exe", "opera://extensions/", "https://www.opera.com/download",
                    Path.Combine(local, "Programs", "Opera", "opera.exe"),
                    Path.Combine(local, "Programs", "Opera", "launcher.exe"),
                    Path.Combine(programFiles, "Opera", "opera.exe"),
                    Path.Combine(programFilesX86, "Opera", "opera.exe"))
            };
        }

        internal static string FindBrowser(BrowserInfo browser)
        {
            string registryPath = FindInAppPaths(browser.ExeName);
            if (!string.IsNullOrEmpty(registryPath) && File.Exists(registryPath))
                return registryPath;

            return browser.CandidatePaths.FirstOrDefault(File.Exists);
        }

        private static string FindInAppPaths(string exeName)
        {
            RegistryHive[] hives = { RegistryHive.CurrentUser, RegistryHive.LocalMachine };
            RegistryView[] views = Environment.Is64BitOperatingSystem
                ? new[] { RegistryView.Registry64, RegistryView.Registry32 }
                : new[] { RegistryView.Registry32 };

            foreach (RegistryHive hive in hives)
            {
                foreach (RegistryView view in views)
                {
                    try
                    {
                        using (RegistryKey baseKey = RegistryKey.OpenBaseKey(hive, view))
                        using (RegistryKey key = baseKey.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + exeName))
                        {
                            object value = key == null ? null : key.GetValue(null);
                            if (value != null)
                                return Environment.ExpandEnvironmentVariables(value.ToString().Trim('"'));
                        }
                    }
                    catch
                    {
                        // Kayıt defteri erişimi başarısızsa bilinen dosya yolları denenir.
                    }
                }
            }

            return null;
        }

        internal static void StartProcess(string fileName, string arguments)
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments ?? string.Empty,
                UseShellExecute = true
            });
        }
    }

    internal sealed class SetupHelperForm : Form
    {
        private readonly List<BrowserInfo> browsers;

        public SetupHelperForm()
        {
            Text = "MangaLens TR - Kurulum Yardımcısı";
            StartPosition = FormStartPosition.CenterScreen;
            MinimumSize = new Size(720, 560);
            Size = new Size(820, 640);
            BackColor = Color.FromArgb(246, 248, 252);
            Font = new Font("Segoe UI", 10F, FontStyle.Regular, GraphicsUnit.Point);
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);

            browsers = Program.CreateBrowserList();
            foreach (BrowserInfo browser in browsers)
                browser.ExecutablePath = Program.FindBrowser(browser);

            BuildInterface();
        }

        private void BuildInterface()
        {
            TableLayoutPanel layout = new TableLayoutPanel
            {
                Dock = DockStyle.Fill,
                Padding = new Padding(28, 24, 28, 20),
                ColumnCount = 1,
                RowCount = 7,
                AutoScroll = true
            };
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100F));
            layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            Controls.Add(layout);

            Label title = new Label
            {
                Text = "MangaLens TR tarayıcıya yükleme",
                AutoSize = true,
                Font = new Font("Segoe UI Semibold", 19F, FontStyle.Bold),
                ForeColor = Color.FromArgb(26, 38, 64),
                Margin = new Padding(0, 0, 0, 8)
            };
            layout.Controls.Add(title);

            Label intro = new Label
            {
                Text = "Uzantı dosyaları bilgisayarınıza kuruldu. Kullanacağınız tarayıcıyı açın ve aşağıdaki üç adımı bir kez tamamlayın.",
                AutoSize = true,
                MaximumSize = new Size(735, 0),
                ForeColor = Color.FromArgb(65, 77, 99),
                Margin = new Padding(0, 0, 0, 16)
            };
            layout.Controls.Add(intro);

            Label steps = new Label
            {
                Text = "1. Tarayıcı düğmesine basın ve Geliştirici modu'nu açın.\r\n" +
                       "2. Paketlenmemiş öğe yükle düğmesine basıp aşağıdaki Extension klasörünü seçin.\r\n" +
                       "3. MangaLens TR simgesini tarayıcı araç çubuğuna sabitleyin ve API anahtarınızı ekleyin.",
                AutoSize = true,
                MaximumSize = new Size(735, 0),
                Padding = new Padding(16),
                BackColor = Color.White,
                ForeColor = Color.FromArgb(35, 48, 73),
                Margin = new Padding(0, 0, 0, 14)
            };
            layout.Controls.Add(steps);

            FlowLayoutPanel folderActions = new FlowLayoutPanel
            {
                AutoSize = true,
                Dock = DockStyle.Top,
                WrapContents = true,
                Margin = new Padding(0, 0, 0, 14)
            };
            folderActions.Controls.Add(CreateActionButton("Extension klasörünü aç", delegate
            {
                TryAction(delegate { Program.StartProcess("explorer.exe", "\"" + ProgramPath + "\""); });
            }, Color.FromArgb(36, 99, 235)));
            folderActions.Controls.Add(CreateActionButton("Klasör yolunu kopyala", delegate
            {
                TryAction(delegate
                {
                    Clipboard.SetText(ProgramPath);
                    MessageBox.Show("Extension klasörünün yolu panoya kopyalandı.", "MangaLens TR", MessageBoxButtons.OK, MessageBoxIcon.Information);
                });
            }, Color.FromArgb(74, 85, 104)));
            layout.Controls.Add(folderActions);

            Label browserTitle = new Label
            {
                Text = "Kurulu tarayıcılar",
                AutoSize = true,
                Font = new Font("Segoe UI Semibold", 12F, FontStyle.Bold),
                ForeColor = Color.FromArgb(26, 38, 64),
                Margin = new Padding(0, 0, 0, 8)
            };
            layout.Controls.Add(browserTitle);

            FlowLayoutPanel browserPanel = new FlowLayoutPanel
            {
                Dock = DockStyle.Fill,
                AutoScroll = true,
                WrapContents = true,
                Margin = new Padding(0)
            };
            List<BrowserInfo> installed = browsers.Where(b => !string.IsNullOrEmpty(b.ExecutablePath)).ToList();
            if (installed.Count == 0)
            {
                browserPanel.Controls.Add(new Label
                {
                    Text = "Desteklenen bir tarayıcı bulunamadı. Aşağıdaki bağlantılardan Chrome, Edge, Brave, Vivaldi veya Opera kurabilirsiniz.",
                    AutoSize = true,
                    MaximumSize = new Size(700, 0),
                    ForeColor = Color.FromArgb(172, 74, 52),
                    Padding = new Padding(0, 6, 0, 10)
                });
            }
            else
            {
                foreach (BrowserInfo browser in installed)
                {
                    BrowserInfo current = browser;
                    browserPanel.Controls.Add(CreateActionButton(current.Name + " uzantılarını aç", delegate
                    {
                        TryAction(delegate { Program.StartProcess(current.ExecutablePath, current.ExtensionsUrl); });
                    }, Color.FromArgb(18, 126, 91)));
                }
            }
            layout.Controls.Add(browserPanel);

            FlowLayoutPanel downloads = new FlowLayoutPanel
            {
                AutoSize = true,
                Dock = DockStyle.Bottom,
                WrapContents = true,
                Margin = new Padding(0, 12, 0, 0)
            };
            downloads.Controls.Add(new Label { Text = "Tarayıcı indir:", AutoSize = true, Padding = new Padding(0, 4, 6, 0) });
            foreach (BrowserInfo browser in browsers)
            {
                BrowserInfo current = browser;
                LinkLabel link = new LinkLabel
                {
                    Text = current.Name,
                    AutoSize = true,
                    Padding = new Padding(0, 4, 8, 0),
                    LinkColor = Color.FromArgb(36, 99, 235)
                };
                link.LinkClicked += delegate { TryAction(delegate { Program.StartProcess(current.DownloadUrl, null); }); };
                downloads.Controls.Add(link);
            }
            layout.Controls.Add(downloads);
        }

        private static string ProgramPath
        {
            get { return Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Extension"); }
        }

        private static Button CreateActionButton(string text, Action action, Color color)
        {
            Button button = new Button
            {
                Text = text,
                AutoSize = true,
                MinimumSize = new Size(190, 40),
                Padding = new Padding(12, 4, 12, 4),
                Margin = new Padding(0, 0, 10, 10),
                FlatStyle = FlatStyle.Flat,
                BackColor = color,
                ForeColor = Color.White,
                Cursor = Cursors.Hand
            };
            button.FlatAppearance.BorderSize = 0;
            button.Click += delegate { action(); };
            return button;
        }

        private static void TryAction(Action action)
        {
            try
            {
                action();
            }
            catch (Exception ex)
            {
                MessageBox.Show("İşlem gerçekleştirilemedi:\r\n" + ex.Message, "MangaLens TR", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }
    }
}
