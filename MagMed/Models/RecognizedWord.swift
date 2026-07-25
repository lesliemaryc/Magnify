import CoreGraphics
import Foundation

struct RecognizedWord: Identifiable, Equatable, Sendable {
    let id: UUID
    let text: String
    /// Vision normalized coordinates, whose origin is the lower-left corner.
    let boundingBox: CGRect
    let confidence: Float

    init(id: UUID = UUID(), text: String, boundingBox: CGRect, confidence: Float) {
        self.id = id
        self.text = text
        self.boundingBox = boundingBox
        self.confidence = confidence
    }
}

struct RecognizedLabel: Sendable {
    let fullText: String
    let words: [RecognizedWord]
}
