import SwiftUI

@main
struct MagMedApp: App {
    @StateObject private var labelStore = MedicineLabelStore()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(labelStore)
                .tint(Color.magMedTeal)
        }
    }
}
