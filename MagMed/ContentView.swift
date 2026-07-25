import PhotosUI
import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var store: MedicineLabelStore
    @State private var photoItem: PhotosPickerItem?
    @State private var showingCamera = false
    @State private var showingWorkspace = false
    @State private var showingNoCamera = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 26) {
                    hero
                    actionCard
                    privacyNote
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 24)
            }
            .background(Color.magMedCanvas)
            .navigationTitle("MagMed")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(isPresented: $showingWorkspace) {
                ScanWorkspaceView()
            }
            .sheet(isPresented: $showingCamera) {
                CameraPicker { image in beginScan(image) }
                    .ignoresSafeArea()
            }
            .alert("Camera unavailable", isPresented: $showingNoCamera) {
                Button("OK", role: .cancel) {}
            } message: {
                Text("Use Choose from Photos on this device.")
            }
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self),
                       let image = UIImage(data: data) {
                        beginScan(image)
                    }
                    photoItem = nil
                }
            }
        }
    }

    private var hero: some View {
        VStack(spacing: 18) {
            ZStack {
                Circle().fill(Color.magMedMint).frame(width: 164, height: 164)
                Circle().stroke(Color.magMedTeal.opacity(0.18), lineWidth: 16).frame(width: 136, height: 136)
                Image(systemName: "pills.circle.fill")
                    .font(.system(size: 84))
                    .symbolRenderingMode(.palette)
                    .foregroundStyle(Color.white, Color.magMedTeal)
            }

            VStack(spacing: 8) {
                Text("Small print, made clear")
                    .font(.largeTitle.bold())
                    .foregroundStyle(Color.magMedNavy)
                    .multilineTextAlignment(.center)
                Text("Photograph a medicine label, translate any word into Korean, and browse the details in a larger, simpler format.")
                    .font(.body)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .lineSpacing(3)
            }
        }
    }

    private var actionCard: some View {
        VStack(spacing: 12) {
            Button {
                if UIImagePickerController.isSourceTypeAvailable(.camera) {
                    showingCamera = true
                } else {
                    showingNoCamera = true
                }
            } label: {
                Label("Take a label photo", systemImage: "camera.fill")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 15)
            }
            .buttonStyle(.borderedProminent)
            .buttonBorderShape(.roundedRectangle(radius: 15))

            PhotosPicker(selection: $photoItem, matching: .images) {
                Label("Choose from Photos", systemImage: "photo.on.rectangle")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
            }
            .buttonStyle(.bordered)
            .buttonBorderShape(.roundedRectangle(radius: 15))
        }
        .padding(18)
        .background(.white, in: RoundedRectangle(cornerRadius: 24))
        .shadow(color: Color.magMedNavy.opacity(0.08), radius: 16, y: 6)
    }

    private var privacyNote: some View {
        Label("Label text is recognized on your device.", systemImage: "lock.shield.fill")
            .font(.footnote)
            .foregroundStyle(.secondary)
    }

    private func beginScan(_ image: UIImage) {
        store.reset()
        showingWorkspace = true
        Task { await store.scan(image) }
    }
}
