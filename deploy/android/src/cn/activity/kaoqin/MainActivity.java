package cn.activity.kaoqin;

import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.PermissionRequest;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.EditText;
import android.widget.Toast;

import java.io.File;
import java.util.ArrayList;
import java.util.Locale;

/**
 * 示例影像部 · 运动会考勤系统 —— Android 客户端（WebView 壳）
 * 默认地址写死为 https://example.com
 * 长按屏幕可临时改地址；导出 Excel 完成后自动跳到文件（下载文件夹）。
 */
public class MainActivity extends Activity {

    /** 写死的服务器地址 */
    public static final String DEFAULT_URL = "https://example.com";

    private static final String PREFS = "kaoqin";
    private static final String KEY_URL = "server_url";
    private static final int REQ_FILE = 1001;
    private static final String JS_BRIDGE = "kaoqinNative";

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private String serverUrl;
    private String lastFailedUrl;
    /** 记录本次导出/下载的任务 ID，用于下载完成后跳转 */
    private final ArrayList<Long> exportIds = new ArrayList<>();
    private long apkDownloadId = -1;
    private String lastPromptVer = "";   // 已提示过的远端版本号
    private volatile boolean promptedLatest = false;   // 已确认拿到最新版本信息
    private volatile boolean checkedOnce = false;      // 已成功查询过一次

    private final BroadcastReceiver downloadReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
            if (id < 0) return;
            if (id == apkDownloadId) { apkDownloadId = -1; installApk(id); return; }
            if (!exportIds.contains(id)) return;
            exportIds.remove(id);
            onDownloadFinished(id);
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WebView.setDataDirectorySuffix("kaoqin");
        }

        SharedPreferences sp = getSharedPreferences(PREFS, MODE_PRIVATE);
        serverUrl = normalize(sp.getString(KEY_URL, DEFAULT_URL));

        web = new WebView(this);
        setContentView(web);
        web.setBackgroundColor(0xFFEEF2F7);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(true);
        s.setDisplayZoomControls(false);
        s.setSupportZoom(true);
        s.setJavaScriptCanOpenWindowsAutomatically(true);
        s.setSupportMultipleWindows(false);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
            CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);
        }
        CookieManager.getInstance().setAcceptCookie(true);
        s.setUserAgentString(s.getUserAgentString() + " KaoqinApp");   // 让页面知道自己在 App 里
        applyThemeMode(s);
        try {
            web.addJavascriptInterface(new ThemeBridge(), JS_BRIDGE);
        } catch (Exception ignored) {
        }
        syncSystemTheme();
        web.setLongClickable(true);
        web.setHapticFeedbackEnabled(true);

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl());
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(Uri.parse(url));
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                lastFailedUrl = null;
                injectSettingsShortcut(view);
                syncSystemTheme();  // 同步系统深色给网页
                checkAppUpdate();   // 网页热更新之外，再看原生壳有没有新版
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    showErrorPage();
                }
            }

            @SuppressWarnings("deprecation")
            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                showErrorPage();
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> cb,
                                             FileChooserParams params) {
                if (fileCallback != null) {
                    fileCallback.onReceiveValue(null);
                }
                fileCallback = cb;
                try {
                    startActivityForResult(params.createIntent(), REQ_FILE);
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    Toast.makeText(MainActivity.this, "没有可用的文件选择器", Toast.LENGTH_SHORT).show();
                    return false;
                }
                return true;
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        request.deny();
                    }
                });
            }
        });

        web.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition,
                                        String mimeType, long contentLength) {
                startDownload(url, userAgent, contentDisposition, mimeType);
            }
        });


        registerDownloadReceiver();

        // 启动就检查一次更新，并做多次重试（隔几个版本没更新时也能拿到提示）
        startUpdateCheck();

        if (savedInstanceState != null) {
            web.restoreState(savedInstanceState);
        } else {
            loadFresh(serverUrl);
        }
    }

    /** 注册"下载完成"广播（导出完成后跳转文件用） */
    private void registerDownloadReceiver() {
        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= 33) {
            registerReceiver(downloadReceiver, filter, Context.RECEIVER_EXPORTED);
        } else {
            registerReceiver(downloadReceiver, filter);
        }
    }

    @Override
    protected void onDestroy() {
        try {
            unregisterReceiver(downloadReceiver);
        } catch (Exception ignored) {
        }
        super.onDestroy();
    }

    /** 拿一次性下载链接 -> 跳系统浏览器下载（浏览器负责下载与"保存到下载文件夹"） */
    private void openExportInBrowser(final String exportUrl) {
        final String cookie = CookieManager.getInstance().getCookie(serverUrl);
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    String path = exportUrl;
                    try {
                        java.net.URL u0 = new java.net.URL(exportUrl);
                        path = u0.getPath();
                        if (u0.getQuery() != null) path += "?" + u0.getQuery();
                    } catch (Exception ignored) {
                    }
                    String api = serverUrl + "/api/export/link?from=app&u="
                            + java.net.URLEncoder.encode(path, "UTF-8");
                    java.net.HttpURLConnection c = (java.net.HttpURLConnection) new java.net.URL(api).openConnection();
                    c.setConnectTimeout(6000);
                    c.setReadTimeout(20000);
                    c.setRequestProperty("Cookie", cookie == null ? "" : cookie);
                    boolean ok = c.getResponseCode() == 200;
                    java.io.InputStream is = ok ? c.getInputStream() : c.getErrorStream();
                    java.io.BufferedReader r = new java.io.BufferedReader(
                            new java.io.InputStreamReader(is, "UTF-8"));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = r.readLine()) != null) sb.append(line);
                    r.close();
                    String body = sb.toString();
                    if (!ok) {
                        String reason = "";
                        try { reason = new org.json.JSONObject(body).optString("error", ""); } catch (Exception pe) { reason = body; }
                        if (c.getResponseCode() == 401) reason = "登录状态已过期，请在应用里重新登录后再导出";
                        if (c.getResponseCode() == 403) reason = "当前账号没有导出权限（导出仅管理员可用）";
                        throw new Exception(reason.isEmpty() ? ("HTTP " + c.getResponseCode()) : reason);
                    }
                    org.json.JSONObject j = new org.json.JSONObject(body);
                    final String link = j.optString("url", "");
                    if (link.isEmpty()) throw new Exception("服务器未返回下载链接");
                    new Handler(Looper.getMainLooper()).post(new Runnable() {
                        @Override
                        public void run() {
                            openInSystemBrowser(serverUrl + link);
                        }
                    });
                } catch (Exception e) {
                    final String msg = e.getMessage();
                    new Handler(Looper.getMainLooper()).post(new Runnable() {
                        @Override
                        public void run() {
                            Toast.makeText(MainActivity.this, "打开浏览器失败：" + msg, Toast.LENGTH_LONG).show();
                        }
                    });
                }
            }
        }).start();
    }

    /** 用系统默认浏览器打开链接（由浏览器负责下载） */
    private void openInSystemBrowser(String url) {
        try {
            Intent i = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            i.setDataAndType(Uri.parse(url), "text/html");
            startActivity(i);
            Toast.makeText(this, "已跳转浏览器下载，完成后可在浏览器下载列表查看", Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            Toast.makeText(this, "打开浏览器失败：" + e.getMessage() + "\n链接：" + url, Toast.LENGTH_LONG).show();
        }
    }

    /** 打开网页时附一个时间戳，保证每次都是最新的页面（网页端热更新） */
    private void loadFresh(String url) {
        if (url == null || url.isEmpty()) return;
        String u = url;
        try {
            if (!u.contains("t=")) {
                u = u + (u.contains("?") ? "&" : "?") + "t=" + System.currentTimeMillis();
            }
        } catch (Exception ignored) {
        }
        web.loadUrl(u);
    }

    /** 启动时连续检查几次（首次可能网络未就绪），确保旧版本用户也能收到更新提示 */
    private void startUpdateCheck() {
        new Thread(new Runnable() {
            @Override
            public void run() {
                long[] waits = new long[] { 0, 3000, 8000, 20000, 60000 };
                for (int i = 0; i < waits.length; i++) {
                    if (waits[i] > 0) {
                        try { Thread.sleep(waits[i]); } catch (InterruptedException e) { return; }
                    }
                    if (promptedLatest || checkedOnce) return;
                    checkAppUpdate();
                }
            }
        }).start();
    }

    /** 问服务器要最新版本；比本机新就提示更新 */
    private void checkAppUpdate() {
        new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    final String localVer = versionName();
                    final String base = serverUrl;
                    java.net.URL u = new java.net.URL(base + "/api/version");
                    java.net.HttpURLConnection c = (java.net.HttpURLConnection) u.openConnection();
                    c.setConnectTimeout(5000);
                    c.setReadTimeout(5000);
                    java.io.BufferedReader r = new java.io.BufferedReader(
                            new java.io.InputStreamReader(c.getInputStream(), "UTF-8"));
                    StringBuilder sb = new StringBuilder();
                    String line;
                    while ((line = r.readLine()) != null) sb.append(line);
                    r.close();
                    org.json.JSONObject j = new org.json.JSONObject(sb.toString());
                    final String remoteVer = j.optString("version", "");
                    final String ver = j.optString("version", "");
                    final String log = j.optString("changelog", "");
                    checkedOnce = true;   // 查询成功，无需继续重试
                    if (isNewer(remoteVer, localVer)) {
                        new Handler(Looper.getMainLooper()).post(new Runnable() {
                            @Override
                            public void run() {
                                promptUpdate(ver, log);
                            }
                        });
                    }
                } catch (Exception e) {
                    android.util.Log.w("kaoqin", "检查更新失败：" + e.getMessage());
                }
            }
        }).start();
    }

    /** 更新弹窗：显示真实版本号 + 更新日志 */
    private void promptUpdate(String ver, String logJson) {
        if (isFinishing()) return;
        if (ver.equals(lastPromptVer)) return;   // 同一版本只提示一次
        lastPromptVer = ver;
        promptedLatest = true;                   // 已经拿到最新版本，停止重试
        final String localName = versionName();
        StringBuilder sb = new StringBuilder();
        sb.append("当前版本：").append(localName).append("\n");
        sb.append("最新版本：").append(ver).append("\n\n");
        String[] logs = parseChangelog(logJson);
        if (logs.length > 0) {
            sb.append("更新内容：\n");
            int n = Math.min(logs.length, 5);
            for (int i = 0; i < n; i++) sb.append("· ").append(logs[i]).append("\n");
            if (logs.length > n) sb.append("· ……\n");
        } else {
            sb.append("下载安装后即可使用最新功能。");
        }
        new AlertDialog.Builder(this)
                .setTitle("发现新版本 " + ver)
                .setMessage(sb.toString().trim())
                .setPositiveButton("下载更新", (d, w) -> downloadApk())
                .setNegativeButton("以后再说", null)
                .show();
    }

    private String versionName() {
        try {
            return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    /** 比较 1.x.x 版本号：远端比本地新返回 true（只比数字，不涉及 versionCode） */
    private boolean isNewer(String remote, String local) {
        if (remote == null || remote.isEmpty()) return false;
        int[] r = parseVer(remote);
        int[] l = parseVer(local);
        for (int i = 0; i < 3; i++) {
            if (r[i] != l[i]) return r[i] > l[i];
        }
        return false;
    }

    private int[] parseVer(String v) {
        int[] out = new int[] { 0, 0, 0 };
        try {
            String[] parts = v.trim().split("\\.");
            for (int i = 0; i < 3 && i < parts.length; i++) {
                out[i] = Integer.parseInt(parts[i].replaceAll("[^0-9]", ""));
            }
        } catch (Exception ignored) {
        }
        return out;
    }

    /** 服务端返回的 changelog 可能是数组或字符串，统一成字符串数组 */
    private String[] parseChangelog(String log) {
        if (log == null || log.isEmpty() || "null".equals(log)) return new String[0];
        String s = log.trim();
        if (s.startsWith("[")) {
            try {
                org.json.JSONArray arr = new org.json.JSONArray(s);
                String[] out = new String[arr.length()];
                for (int i = 0; i < arr.length(); i++) out[i] = arr.optString(i, "");
                return out;
            } catch (Exception ignored) {
            }
        }
        return s.split("\\r?\\n");
    }

    /** 下载新版 APK，完成后自动弹出安装界面 */
    private void downloadApk() {
        try {
            String url = serverUrl + "/download/activity-kaoqin.apk";
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            req.setMimeType("application/vnd.android.package-archive");
            req.setTitle("示例考勤 " + System.currentTimeMillis() + ".apk");
            req.setDescription("正在下载新版本");
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, "activity-kaoqin.apk");
            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm == null) return;
            long id = dm.enqueue(req);
            apkDownloadId = id;
            Toast.makeText(this, "正在下载新版本…", Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            Toast.makeText(this, "下载失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    /** 下载完成后调起系统安装界面 */
    private void installApk(long id) {
        try {
            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            Uri uri = dm == null ? null : dm.getUriForDownloadedFile(id);
            if (uri == null) {
                Toast.makeText(this, "已下载，请在通知栏或下载文件夹里点开安装", Toast.LENGTH_LONG).show();
                return;
            }
            // 安卓 8.0+ 安装第三方应用需要"安装未知应用"权限，没开会自动跳系统设置让用户授权
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                    && !getPackageManager().canRequestPackageInstalls()) {
                new AlertDialog.Builder(this)
                        .setTitle("需要开启安装权限")
                        .setMessage("请允许《示例考勤》安装应用：在接下来的页面里打开开关，返回后会自动继续安装。")
                        .setPositiveButton("去设置", (d, w) -> {
                            try {
                                Intent set = new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                        Uri.parse("package:" + getPackageName()));
                                startActivity(set);
                            } catch (Exception ex) {
                                Toast.makeText(this, "请手动到 设置-应用-安装未知应用 里允许", Toast.LENGTH_LONG).show();
                            }
                        })
                        .setNegativeButton("取消", null)
                        .show();
                return;
            }
            Intent i = new Intent(Intent.ACTION_VIEW);
            i.setDataAndType(uri,
                    "application/vnd.android.package-archive");
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);
            startActivity(i);
        } catch (Exception e) {
            Toast.makeText(this, "已下载，请在通知栏点开安装", Toast.LENGTH_LONG).show();
        }
    }

    /** 暴露给网页：系统当前是否深色（WebView 的 prefers-color-scheme 在部分机型不生效） */
    public class ThemeBridge {
        @android.webkit.JavascriptInterface
        public boolean isSystemDark() {
            return systemDark();
        }
    }

    private boolean systemDark() {
        try {
            int night = getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK;
            return night == android.content.res.Configuration.UI_MODE_NIGHT_YES;
        } catch (Exception e) {
            return false;
        }
    }

    /** 把系统深色状态同步给网页（网页据此实现"跟随系统"） */
    private void syncSystemTheme() {
        if (web == null) return;
        final boolean dark = systemDark();
        web.post(new Runnable() {
            @Override
            public void run() {
                try {
                    String js = "window.__SYSTEM_DARK__=" + (dark ? "true" : "false") + ";"
                            + "window.__APP__=1;"
                            + "try{if(window.__applyTheme)window.__applyTheme(localStorage.getItem('kaoqin.theme')||'auto');}catch(e){}";
                    web.evaluateJavascript(js, null);
                } catch (Exception ignored) {
                }
            }
        });
    }

    /** 系统深浅色变化时，同步给网页 */
    @Override
    public void onConfigurationChanged(android.content.res.Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        try {
            applyThemeMode(web.getSettings());
        } catch (Exception ignored) {
        }
        syncSystemTheme();
        // 再延迟同步一次：系统切换时 WebView 的深色状态可能稍后才生效
        new Handler(Looper.getMainLooper()).postDelayed(new Runnable() {
            @Override
            public void run() {
                try {
                    applyThemeMode(web.getSettings());
                } catch (Exception ignored) {
                }
                syncSystemTheme();
            }
        }, 400);
    }

    /** 让网页的 prefers-color-scheme 跟随系统深色设置 */
    private void applyThemeMode(WebSettings s) {
        try {
            int night = getResources().getConfiguration().uiMode & android.content.res.Configuration.UI_MODE_NIGHT_MASK;
            boolean dark = night == android.content.res.Configuration.UI_MODE_NIGHT_YES;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                s.setAlgorithmicDarkeningAllowed(true);   // API 33+：允许网页跟随系统深色
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                s.setForceDark(dark ? WebSettings.FORCE_DARK_ON : WebSettings.FORCE_DARK_OFF);
            }
        } catch (Exception ignored) {
        }
    }

    /** 注入：双击顶部标题栏打开"服务器地址"设置（长按留给页面的备注功能） */
    private void injectSettingsShortcut(WebView view) {
        String js = "(function(){try{" +
            "var el=document.querySelector('.topbar')||document.querySelector('#app-title')||document.querySelector('.brand-logo.small');" +
            "if(!el||el.dataset.kaoqinDbl)return;el.dataset.kaoqinDbl='1';" +
            "el.addEventListener('dblclick',function(){location.href='kaoqin://settings';});" +
            "}catch(e){}})();";
        view.evaluateJavascript(js, null);
    }

    /** 返回 true 表示我们自己处理了这个链接 */
    private boolean handleUrl(Uri uri) {
        if (uri == null) {
            return false;
        }
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        String url = uri.toString();
        String lower = url.toLowerCase(Locale.ROOT);

        // 双击标题栏触发的设置入口
        if ("kaoqin".equals(scheme)) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    showUrlDialog();
                }
            });
            return true;
        }

        // 导出 Excel：跳转到系统默认浏览器下载（浏览器没有登录 Cookie，
        // 所以先用 App 的会话换一个一次性下载链接，再把该链接交给浏览器）
        if (lower.contains("/api/export") || lower.endsWith(".xlsx") || lower.endsWith(".xls")
                || lower.contains(".xlsx?") || lower.contains(".xls?")) {
            openExportInBrowser(url);
            return true;
        }

        // 下载中心的文件（App 安装包、使用手册）一律交给系统浏览器下载
        if (lower.contains("/download/")) {
            openInSystemBrowser(url);
            return true;
        }

        if ("http".equals(scheme) || "https".equals(scheme)) {
            if (url.startsWith("https://example.com") || url.startsWith(serverUrl)) {
                return false;
            }
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, uri));
            } catch (ActivityNotFoundException ignored) {
                return false;
            }
            return true;
        }

        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (ActivityNotFoundException ignored) {
        }
        return true;
    }

    private void startDownload(String url, String userAgent, String contentDisposition, String mimeType) {
        try {
            String cookie = CookieManager.getInstance().getCookie(url);
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url));
            String name = URLUtil.guessFileName(url, contentDisposition, mimeType);
            req.setMimeType(mimeType == null || mimeType.isEmpty()
                    ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : mimeType);
            req.addRequestHeader("Cookie", cookie == null ? "" : cookie);
            req.addRequestHeader("User-Agent", userAgent);
            req.setTitle(name);
            req.setDescription("示例考勤导出文件");
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm != null) {
                long id = dm.enqueue(req);
                exportIds.add(id);
                Toast.makeText(this, "正在下载：" + name, Toast.LENGTH_LONG).show();
            }
        } catch (Exception e) {
            Toast.makeText(this, "下载失败：" + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    /** 下载完成后：跳到文件所在文件夹（失败则直接打开该文件） */
    private void onDownloadFinished(long id) {
        DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
        if (dm == null) return;
        String path = null;
        String name = null;
        String mime = null;
        Cursor c = null;
        try {
            c = dm.query(new DownloadManager.Query().setFilterById(id));
            if (c != null && c.moveToFirst()) {
                int status = c.getInt(c.getColumnIndexOrThrow(DownloadManager.COLUMN_STATUS));
                if (status != DownloadManager.STATUS_SUCCESSFUL) {
                    toast("下载未完成，可在通知栏查看");
                    return;
                }
                path = c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_LOCAL_URI));
                name = c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_TITLE));
                mime = c.getString(c.getColumnIndexOrThrow(DownloadManager.COLUMN_MEDIA_TYPE));
            }
        } catch (Exception ignored) {
        } finally {
            if (c != null) c.close();
        }

        File file = uriToFile(path);
        if (file == null || !file.exists()) {
            toast("文件已保存到手机的「下载」文件夹");
            return;
        }
        if (mime == null || mime.isEmpty()) {
            mime = file.getName().toLowerCase(Locale.ROOT).endsWith(".xls")
                    ? "application/vnd.ms-excel"
                    : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
        }

        Intent view = new Intent(Intent.ACTION_VIEW);
        view.setDataAndType(Uri.fromFile(file), mime);
        view.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);

        // 1) 尝试跳到文件所在文件夹（不同文件管理器支持不一，失败则继续）
        Intent folder = new Intent(Intent.ACTION_VIEW);
        folder.setDataAndType(Uri.fromFile(file.getParentFile()), "resource/folder");
        folder.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(folder);
            toast("已保存：" + (name == null ? file.getName() : name));
            return;
        } catch (Exception ignored) {
        }
        // 2) 直接打开刚导出的文件（WPS / Excel）
        try {
            startActivity(view);
            toast("已保存：" + (name == null ? file.getName() : name));
            return;
        } catch (Exception ignored) {
        }
        // 3) 交给系统文件管理器（部分系统只认 content://）
        try {
            Intent open = new Intent(Intent.ACTION_VIEW);
            Uri uri = Uri.fromFile(file);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                uri = MediaStore.Downloads.EXTERNAL_CONTENT_URI;
            }
            open.setDataAndType(uri, mime);
            open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(open);
            return;
        } catch (Exception ignored) {
        }
        toast("文件已保存到「下载」文件夹：" + (name == null ? file.getName() : name));
    }

    private static File uriToFile(String uriString) {
        if (uriString == null) return null;
        try {
            Uri uri = Uri.parse(uriString);
            if ("file".equals(uri.getScheme())) {
                return new File(uri.getPath());
            }
        } catch (Exception ignored) {
        }
        return null;
    }

    private void toast(String text) {
        Toast.makeText(this, text, Toast.LENGTH_LONG).show();
    }

    private void showErrorPage() {
        final String target = serverUrl;
        if (target.equals(lastFailedUrl)) {
            return;
        }
        lastFailedUrl = target;
        String html = "<!DOCTYPE html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\">"
                + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
                + "<style>body{margin:0;height:100vh;display:flex;flex-direction:column;"
                + "align-items:center;justify-content:center;font-family:sans-serif;background:#eef2f7;color:#17202a}"
                + "h2{color:#0f2b46;margin:0 0 8px}p{color:#6b7c8f;margin:0 0 18px;font-size:14px}"
                + "a{display:inline-block;background:#0f2b46;color:#fff;text-decoration:none;"
                + "padding:10px 22px;border-radius:8px;font-size:14px}</style></head><body>"
                + "<h2>打不开考勤系统</h2><p>请检查网络，或确认服务器地址是否正确</p>"
                + "<p style=\"font-size:12px\">" + target + "</p>"
                + "<a href=\"" + target + "\">重试</a></body></html>";
        web.loadDataWithBaseURL(target, html, "text/html", "utf-8", target);
    }

    private void showUrlDialog() {
        final EditText input = new EditText(this);
        input.setText(serverUrl);
        input.setSingleLine(true);
        new android.app.AlertDialog.Builder(this)
                .setTitle("服务器地址")
                .setMessage("默认：https://example.com")
                .setView(input)
                .setPositiveButton("保存并重开", (d, w) -> {
                    String v = normalize(input.getText().toString());
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_URL, v).apply();
                    serverUrl = v;
                    lastFailedUrl = null;
                    loadFresh(v);
                })
                .setNegativeButton("取消", null)
                .setNeutralButton("恢复默认", (d, w) -> {
                    getSharedPreferences(PREFS, MODE_PRIVATE).edit().remove(KEY_URL).apply();
                    serverUrl = DEFAULT_URL;
                    lastFailedUrl = null;
                    loadFresh(serverUrl);
                })
                .show();
    }

    private static String normalize(String raw) {
        String v = raw == null ? "" : raw.trim();
        if (v.isEmpty()) {
            return DEFAULT_URL;
        }
        if (!v.startsWith("http://") && !v.startsWith("https://")) {
            v = "https://" + v;
        }
        while (v.endsWith("/")) {
            v = v.substring(0, v.length() - 1);
        }
        return v;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE) {
            if (fileCallback != null) {
                fileCallback.onReceiveValue(
                        WebChromeClient.FileChooserParams.parseResult(resultCode, data));
                fileCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        if (web != null) {
            web.saveState(outState);
        }
    }
}
