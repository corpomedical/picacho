import UIKit
import Capacitor

// Picacho for iPhone and iPad: a Capacitor shell around the live site
// (capacitor.config.ts, MOBILE_APP.md). The window and the web view are made
// in SceneDelegate; everything the site asks of the phone goes through the
// plugins, Capacitor's own and the two in this folder (PicachoViewController
// registers those).
@main
class AppDelegate: UIResponder, UIApplicationDelegate {

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        return true
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }

    // MARK: - Push notifications
    //
    // A finished video reaches the phone as a push (lib/push/send.ts). The
    // site asks for permission and registers once the person is signed in
    // (native-push.tsx); Apple answers here, and @capacitor/push-notifications
    // turns the device token into the hex string the site stores in
    // push_tokens with platform "ios". The server sends those straight to
    // Apple's push service (lib/push/apns.ts); Android's go through FCM.

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }
}
