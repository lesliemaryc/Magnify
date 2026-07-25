import Combine
import UIKit

@MainActor
final class MedicineLabelStore: ObservableObject {
    @Published var image: UIImage?
    @Published var recognizedLabel: RecognizedLabel?
    @Published var sections: [LabelSection] = []
    @Published var isScanning = false
    @Published var errorMessage: String?

    var hasScan: Bool { image != nil && recognizedLabel != nil }

    func scan(_ newImage: UIImage) async {
        image = newImage.normalizedOrientation()
        recognizedLabel = nil
        sections = []
        errorMessage = nil
        isScanning = true

        do {
            guard let image else { return }
            let result = try await LabelOCRService.recognize(image: image)
            recognizedLabel = result
            sections = LabelSummaryService.sections(from: result.fullText)
            if result.words.isEmpty {
                errorMessage = "No readable text was found. Try a brighter, sharper photo taken straight above the label."
            }
        } catch {
            errorMessage = "The label could not be read. Please try another photo."
        }
        isScanning = false
    }

    func reset() {
        image = nil
        recognizedLabel = nil
        sections = []
        errorMessage = nil
        isScanning = false
    }
}

private extension UIImage {
    func normalizedOrientation() -> UIImage {
        guard imageOrientation != .up else { return self }
        let renderer = UIGraphicsImageRenderer(size: size)
        return renderer.image { _ in
            draw(in: CGRect(origin: .zero, size: size))
        }
    }
}
