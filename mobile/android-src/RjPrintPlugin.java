package in.rungnna.shopos;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/* Prints a bill / label sheet through Android's print service (installed printer apps or Save as PDF).
   The app's web view cannot call window.print(), so the page's HTML is handed over here. */
@CapacitorPlugin(name = "RjPrint")
public class RjPrintPlugin extends Plugin {
    private WebView printView;   // kept alive until the print job has its content

    @PluginMethod
    public void printHtml(PluginCall call) {
        final String html = call.getString("html", "");
        final String name = call.getString("name", "Rungnna bill");
        getActivity().runOnUiThread(() -> {
            WebView view = new WebView(getContext());
            printView = view;
            view.getSettings().setJavaScriptEnabled(false);
            view.setWebViewClient(new WebViewClient() {
                @Override
                public void onPageFinished(WebView v, String url) {
                    PrintManager pm = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
                    pm.print(name, v.createPrintDocumentAdapter(name), new PrintAttributes.Builder().build());
                    call.resolve(new JSObject());
                }
            });
            view.loadDataWithBaseURL("https://localhost/", html, "text/html", "UTF-8", null);
        });
    }
}
