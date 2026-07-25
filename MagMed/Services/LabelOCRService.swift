import UIKit
@preconcurrency import Vision

enum LabelOCRService {
    static func recognize(image: UIImage) async throws -> RecognizedLabel {
        guard let cgImage = image.cgImage else { throw OCRError.invalidImage }

        return try await withCheckedThrowingContinuation { continuation in
            let request = VNRecognizeTextRequest { request, error in
                if let error {
                    continuation.resume(throwing: error)
                    return
                }

                let observations = (request.results as? [VNRecognizedTextObservation]) ?? []
                let lines = observations.compactMap { $0.topCandidates(1).first?.string }
                var words: [RecognizedWord] = []

                for observation in observations {
                    guard let candidate = observation.topCandidates(1).first else { continue }
                    candidate.string.enumerateSubstrings(
                        in: candidate.string.startIndex..<candidate.string.endIndex,
                        options: [.byWords, .localized]
                    ) { substring, range, _, _ in
                        guard let substring,
                              let box = try? candidate.boundingBox(for: range) else { return }
                        words.append(
                            RecognizedWord(
                                text: substring,
                                boundingBox: box.boundingBox,
                                confidence: candidate.confidence
                            )
                        )
                    }
                }

                continuation.resume(
                    returning: RecognizedLabel(fullText: lines.joined(separator: "\n"), words: words)
                )
            }

            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = true
            request.recognitionLanguages = ["en-US"]
            request.minimumTextHeight = 0.006

            let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up)
            DispatchQueue.global(qos: .userInitiated).async {
                do {
                    try handler.perform([request])
                } catch {
                    continuation.resume(throwing: error)
                }
            }
        }
    }

    private enum OCRError: Error {
        case invalidImage
    }
}
