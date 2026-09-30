import UIKit
import WebKit
import Capacitor

// Capacitor's bridge view controller, with what makes it Picacho's:
//
// - the app's own plugins, registered before the page loads (the iOS twin of
//   MainActivity.registerPlugin on Android);
// - portrait on iPhone, except while the site has a picture or video open
//   full screen (PicachoOrientation); every orientation on iPad;
// - the launch screen, the splash and the web view's ground follow the
//   phone's light/dark setting, the way the Android splash and the site's
//   NativeIntro do;
// - the iOS back gesture: a swipe in from the left edge goes back a page,
//   the way the Android back button does.
class PicachoViewController: CAPBridgeViewController {

    private var landscapeAllowed = false

    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()

        // capacitor.config.ts gives both shells one white: "#ffffff" for the
        // web view's ground and for the splash. Android's splash has its own
        // night drawable; here the same effect comes from the LaunchBackground
        // colour (white, or #0d0c0b in dark mode). Without this, dark mode
        // would open on a white splash around a white wordmark.
        if let ground = UIColor(named: "LaunchBackground") {
            descriptor.backgroundColor = ground
        }
        var plugins = descriptor.pluginConfigurations
        if var splash = plugins["SplashScreen"] as? [String: Any] {
            // The splash is LaunchScreen.storyboard, already painted in the
            // right colour; the plugin's backgroundColor would paint over it.
            splash["backgroundColor"] = nil
            plugins["SplashScreen"] = splash
            // Capacitor re-types a programmatically changed dictionary when
            // it normalizes the descriptor (CAPInstanceDescriptor.normalize).
            descriptor.pluginConfigurations = plugins
        }
        return descriptor
    }

    override func capacitorDidLoad() {
        // Registered here, not listed in capacitor.config: they live in this
        // app, not in an npm package, so `cap sync` never sees them.
        bridge?.registerPluginInstance(OrientationPlugin())
        bridge?.registerPluginInstance(MediaPlugin())

        webView?.allowsBackForwardNavigationGestures = true
    }

    // MARK: - Orientation

    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        // An iPad app turns every way (App Store rule for an iPad app that
        // takes part in multitasking); the site lays itself out for both.
        if UIDevice.current.userInterfaceIdiom == .pad { return .all }
        return landscapeAllowed ? .allButUpsideDown : .portrait
    }

    // A video the web view puts in its own full-screen player is a separate,
    // presented controller and turns sideways by itself; this governs the
    // page.
    func setLandscapeAllowed(_ allowed: Bool) {
        guard landscapeAllowed != allowed else { return }
        landscapeAllowed = allowed
        if #available(iOS 16.0, *) {
            setNeedsUpdateOfSupportedInterfaceOrientations()
            if !allowed, let scene = view.window?.windowScene {
                // Back upright when the viewer closes while the phone is on
                // its side, the way a gallery app does.
                scene.requestGeometryUpdate(.iOS(interfaceOrientations: .portrait)) { _ in }
            }
        } else {
            if !allowed {
                UIDevice.current.setValue(UIInterfaceOrientation.portrait.rawValue, forKey: "orientation")
            }
            UIViewController.attemptRotationToDeviceOrientation()
        }
    }
}
