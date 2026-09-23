package ai.picacho.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Before super: super.onCreate builds the bridge, and a plugin added
        // after that is never reachable from the page.
        registerPlugin(OrientationPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
