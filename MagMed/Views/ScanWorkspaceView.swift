import SwiftUI
import Translation

struct ScanWorkspaceView: View {
    @EnvironmentObject private var store: MedicineLabelStore
    @State private var selectedTab = 0
    @State private var selectedWord: RecognizedWord?
    @State private var translation: String?
    @State private var isTranslating = false
    @State private var translationConfiguration: TranslationSession.Configuration?

    var body: some View {
        VStack(spacing: 0) {
            Picker("View", selection: $selectedTab) {
                Label("Label", systemImage: "viewfinder").tag(0)
                Label("Readable summary", systemImage: "text.alignleft").tag(1)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(.bar)

            Group {
                if store.isScanning {
                    scanningView
                } else if let message = store.errorMessage, store.recognizedLabel?.words.isEmpty != false {
                    errorView(message)
                } else if selectedTab == 0,
                          let image = store.image,
                          let label = store.recognizedLabel {
                    LabelImageView(
                        image: image,
                        words: label.words,
                        selectedWordID: selectedWord?.id,
                        translation: translation,
                        isTranslating: isTranslating,
                        onSelect: select
                    )
                    .overlay(alignment: .bottom) {
                        if selectedWord == nil {
                            Label("Pinch to zoom · touch a word to translate", systemImage: "hand.tap.fill")
                                .font(.footnote.weight(.semibold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 9)
                                .background(.black.opacity(0.64), in: Capsule())
                                .padding(.bottom, 16)
                        }
                    }
                } else {
                    SummaryView(sections: store.sections)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .navigationTitle("Medicine label")
        .navigationBarTitleDisplayMode(.inline)
        .translationTask(translationConfiguration) { session in
            guard let selectedWord else { return }
            do {
                let response = try await session.translate(selectedWord.text)
                guard self.selectedWord?.id == selectedWord.id else { return }
                translation = response.targetText
            } catch {
                guard self.selectedWord?.id == selectedWord.id else { return }
                translation = "번역을 사용할 수 없음"
            }
            isTranslating = false
        }
    }

    private var scanningView: some View {
        VStack(spacing: 22) {
            ZStack {
                RoundedRectangle(cornerRadius: 24)
                    .fill(Color.magMedMint)
                    .frame(width: 112, height: 112)
                Image(systemName: "text.viewfinder")
                    .font(.system(size: 48, weight: .medium))
                    .foregroundStyle(Color.magMedTeal)
            }
            ProgressView().controlSize(.large)
            VStack(spacing: 7) {
                Text("Reading the small print")
                    .font(.title2.bold())
                Text("Finding words and organizing label details…")
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.magMedCanvas)
    }

    private func errorView(_ message: String) -> some View {
        ContentUnavailableView(
            "Couldn’t read this label",
            systemImage: "camera.metering.unknown",
            description: Text(message)
        )
    }

    private func select(_ word: RecognizedWord) {
        selectedWord = word
        translation = nil
        isTranslating = true

        if translationConfiguration == nil {
            translationConfiguration = TranslationSession.Configuration(
                source: Locale.Language(identifier: "en"),
                target: Locale.Language(identifier: "ko")
            )
        } else {
            translationConfiguration?.invalidate()
        }
    }
}
