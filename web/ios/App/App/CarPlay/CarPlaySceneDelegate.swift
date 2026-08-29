import CarPlay
import UIKit

/**
 * CarPlay scene entry — scaffold only.
 * Wire `UIApplicationSceneManifest` → this class after Apple grants carplay-maps.
 * See docs/CARPLAY.md.
 */
class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    var interfaceController: CPInterfaceController?

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didConnect interfaceController: CPInterfaceController
    ) {
        self.interfaceController = interfaceController
        let map = StormPathCarPlayMapTemplate().makeTemplate()
        interfaceController.setRootTemplate(map, animated: true, completion: nil)
    }

    func templateApplicationScene(
        _ templateApplicationScene: CPTemplateApplicationScene,
        didDisconnect interfaceController: CPInterfaceController
    ) {
        self.interfaceController = nil
    }
}
