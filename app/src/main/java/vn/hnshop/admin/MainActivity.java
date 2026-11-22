package vn.hnshop.admin;

import android.app.Activity;
import android.app.DownloadManager;
import android.content.Context;
import android.net.Uri;
import android.os.Bundle;
import android.os.Debug;
import android.os.Environment;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.DownloadListener;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.File;

public class MainActivity extends Activity {
    private static final String ADMIN_URL = "https://nhocli11280-eng.github.io/hnshop-admin/";
    private WebView webView;

    // Basic client-side hardening. This raises the effort required to tamper,
    // but is not a substitute for server-side authorization or a trusted signature.
    private boolean isDebugOrHookEnvironment() {
        if (Debug.isDebuggerConnected() || Debug.waitingForDebugger()) return true;

        String[] indicators = {
            "/data/local/tmp/frida-server",
            "/data/local/tmp/re.frida.server",
            "/system/framework/XposedBridge.jar",
            "/system/lib/libsubstrate.so",
            "/system/lib64/libsubstrate.so"
        };
        for (String path : indicators) {
            if (new File(path).exists()) return true;
        }

        String maps = readTextFile("/proc/self/maps");
        String lower = maps.toLowerCase();
        return lower.contains("frida") || lower.contains("xposed")
                || lower.contains("substrate") || lower.contains("lsposed");
    }

    private String readTextFile(String path) {
        try {
            java.io.BufferedReader reader = new java.io.BufferedReader(
                    new java.io.FileReader(path));
            StringBuilder out = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) out.append(line).append('\n');
            reader.close();
            return out.toString();
        } catch (Exception ignored) {
            return "";
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        if (isDebugOrHookEnvironment()) {
            Toast.makeText(this, "Phát hiện môi trường gỡ lỗi/can thiệp. Ứng dụng sẽ đóng.", Toast.LENGTH_LONG).show();
            finish();
            return;
        }

        // Prevent screenshots and screen recording of the admin app.
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);

        webView = new WebView(this);
        setContentView(webView);

        webView.setWebContentsDebuggingEnabled(false);
        webView.getSettings().setJavaScriptEnabled(true);
        webView.getSettings().setDomStorageEnabled(true);
        webView.getSettings().setDatabaseEnabled(true);
        webView.getSettings().setAllowFileAccess(false);
        webView.getSettings().setUseWideViewPort(true);
        webView.getSettings().setLoadWithOverviewMode(false);
        webView.getSettings().setSupportZoom(false);
        webView.getSettings().setBuiltInZoomControls(false);
        webView.getSettings().setDisplayZoomControls(false);
        webView.setHorizontalScrollBarEnabled(false);
        webView.setVerticalScrollBarEnabled(true);
        webView.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                String host = uri.getHost();
                if (host != null && (host.equals("nhocli11280-eng.github.io")
                        || host.equals("tovdhcylsajhamscnmdm.supabase.co")
                        || host.endsWith(".supabase.co"))) {
                    return false;
                }
                return false;
            }
        });

        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            try {
                DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                request.addRequestHeader("User-Agent", userAgent);
                String cookie = CookieManager.getInstance().getCookie(url);
                if (cookie != null) request.addRequestHeader("Cookie", cookie);
                request.setMimeType(mimeType);
                request.setTitle("HNShop - tải tệp");
                request.setDescription("Đang tải xuống...");
                request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                request.setDestinationInExternalFilesDir(this, Environment.DIRECTORY_DOWNLOADS, "hnshop-export.txt");
                ((DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE)).enqueue(request);
                Toast.makeText(this, "Đang tải tệp xuống...", Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, "Không thể tải tệp: " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        });

        if (savedInstanceState != null) webView.restoreState(savedInstanceState);
        else webView.loadUrl(ADMIN_URL);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
