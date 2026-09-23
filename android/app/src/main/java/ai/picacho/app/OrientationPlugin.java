package ai.picacho.app;

import android.content.pm.ActivityInfo;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// The app is portrait-only (AndroidManifest: screenOrientation="portrait"),
// except while a picture or video is open full screen. The website asks for
// that exception through this plugin (src/lib/native/orientation.ts) when a
// viewer opens and hands it back when the viewer closes.
//
// FULL_USER rather than SENSOR: it rotates only when the person has
// auto-rotate switched on, the way a gallery app does. SENSOR would turn the
// screen against their system setting.
//
// Registered by hand in MainActivity, not through capacitor.plugins.json:
// it lives in this app, not in an npm package, so `cap sync` never lists it.
@CapacitorPlugin(name = "PicachoOrientation")
public class OrientationPlugin extends Plugin {

    @PluginMethod
    public void allowLandscape(PluginCall call) {
        set(ActivityInfo.SCREEN_ORIENTATION_FULL_USER);
        call.resolve();
    }

    @PluginMethod
    public void lockPortrait(PluginCall call) {
        set(ActivityInfo.SCREEN_ORIENTATION_PORTRAIT);
        call.resolve();
    }

    private void set(int orientation) {
        getActivity().runOnUiThread(() -> getActivity().setRequestedOrientation(orientation));
    }
}
