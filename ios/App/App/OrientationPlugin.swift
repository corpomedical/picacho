import Foundation
import Capacitor

// The iOS half of PicachoOrientation (Android: OrientationPlugin.java).
//
// The app stands upright on iPhone, except while a picture or video is open
// full screen. The website asks for that exception when a viewer opens and
// hands it back when the viewer closes (src/lib/native/orientation.ts); the
// counting of nested viewers happens there, so here each call simply sets
// the state. On iPad both calls change nothing: an iPad app turns every way.
@objc(OrientationPlugin)
public class OrientationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "OrientationPlugin"
    public let jsName = "PicachoOrientation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "allowLandscape", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "lockPortrait", returnType: CAPPluginReturnPromise)
    ]

    @objc func allowLandscape(_ call: CAPPluginCall) {
        set(true)
        call.resolve()
    }

    @objc func lockPortrait(_ call: CAPPluginCall) {
        set(false)
        call.resolve()
    }

    private func set(_ allowed: Bool) {
        DispatchQueue.main.async { [weak self] in
            (self?.bridge?.viewController as? PicachoViewController)?.setLandscapeAllowed(allowed)
        }
    }
}
