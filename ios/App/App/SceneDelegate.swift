import UIKit
import Capacitor

// One window, holding Picacho's bridge view controller.
//
// Made here in code rather than from a storyboard: Info.plist names no main
// storyboard, so exactly one bridge (and one web view) is ever created.
// Links that open the app (the ai.picacho.app:// scheme) are handed to
// Capacitor, which passes them to the App plugin's appUrlOpen listeners
// (native-auth-return.tsx).
class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = PicachoViewController()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
