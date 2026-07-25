import SwiftUI
import UIKit

struct LabelImageView: View {
    let image: UIImage
    let words: [RecognizedWord]
    let selectedWordID: UUID?
    let translation: String?
    let isTranslating: Bool
    let onSelect: (RecognizedWord) -> Void

    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        GeometryReader { geometry in
            let imageRect = aspectFitRect(imageSize: image.size, in: geometry.size)

            ZStack {
                Color.black.opacity(0.94)

                ZStack(alignment: .topLeading) {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: geometry.size.width, height: geometry.size.height)

                    ForEach(words) { word in
                        let rect = displayRect(for: word.boundingBox, imageRect: imageRect)
                        RoundedRectangle(cornerRadius: 3)
                            .fill(word.id == selectedWordID ? Color.magMedTeal.opacity(0.40) : .clear)
                            .stroke(word.id == selectedWordID ? Color.white : Color.clear, lineWidth: 1.5)
                            .frame(width: max(rect.width, 8), height: max(rect.height, 8))
                            .position(x: rect.midX, y: rect.midY)
                            .contentShape(Rectangle())
                    }
                }
                .scaleEffect(scale)
                .offset(offset)

                if let selected = words.first(where: { $0.id == selectedWordID }) {
                    translationBubble(for: selected, imageRect: imageRect, viewSize: geometry.size)
                }
            }
            .clipped()
            .contentShape(Rectangle())
            .gesture(selectionGesture(imageRect: imageRect, viewSize: geometry.size))
            .simultaneousGesture(magnificationGesture)
            .simultaneousGesture(panGesture)
            .onTapGesture(count: 2) {
                withAnimation(.spring(response: 0.3)) {
                    scale = scale > 1 ? 1 : 2.5
                    lastScale = scale
                    if scale == 1 { offset = .zero; lastOffset = .zero }
                }
            }
        }
    }

    private func selectionGesture(imageRect: CGRect, viewSize: CGSize) -> some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .local)
            .onEnded { value in
                let isTap = value.translation.width.magnitude < 22 && value.translation.height.magnitude < 22
                // At the base zoom, ending a short swipe over a word selects it. While
                // zoomed, longer drags remain reserved for moving around the label.
                guard scale <= 1.05 || isTap else { return }
                let center = CGPoint(x: viewSize.width / 2, y: viewSize.height / 2)
                let transformedPoint = CGPoint(
                    x: (value.location.x - center.x - offset.width) / scale + center.x,
                    y: (value.location.y - center.y - offset.height) / scale + center.y
                )
                guard let word = words.first(where: {
                    displayRect(for: $0.boundingBox, imageRect: imageRect)
                        .insetBy(dx: -5, dy: -5)
                        .contains(transformedPoint)
                }) else { return }
                onSelect(word)
            }
    }

    @ViewBuilder
    private func translationBubble(for word: RecognizedWord, imageRect: CGRect, viewSize: CGSize) -> some View {
        let rect = displayRect(for: word.boundingBox, imageRect: imageRect)
        let center = CGPoint(x: viewSize.width / 2, y: viewSize.height / 2)
        let selectedX = center.x + (rect.maxX - center.x) * scale + offset.width
        let selectedY = center.y + (rect.midY - center.y) * scale + offset.height
        let bubbleWidth = min(CGFloat(190), viewSize.width - 24)
        let putOnRight = selectedX + bubbleWidth + 18 < viewSize.width
        let x = putOnRight
            ? selectedX + bubbleWidth / 2 + 10
            : max(bubbleWidth / 2 + 12, selectedX - bubbleWidth / 2 - rect.width * scale - 10)

        VStack(alignment: .leading, spacing: 5) {
            Text(word.text)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            if isTranslating {
                HStack(spacing: 7) {
                    ProgressView().controlSize(.small)
                    Text("Translating…")
                }
                .font(.subheadline)
            } else {
                Text(translation ?? "Translation unavailable")
                    .font(.headline)
                    .foregroundStyle(Color.magMedNavy)
            }
        }
        .padding(12)
        .frame(width: bubbleWidth, alignment: .leading)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.white.opacity(0.7)))
        .shadow(color: .black.opacity(0.24), radius: 12, y: 5)
        .position(x: x, y: min(max(selectedY, 55), viewSize.height - 55))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Korean translation for \(word.text): \(translation ?? "loading")")
    }

    private var magnificationGesture: some Gesture {
        MagnifyGesture()
            .onChanged { value in scale = min(max(lastScale * value.magnification, 1), 6) }
            .onEnded { _ in
                lastScale = scale
                if scale == 1 { offset = .zero; lastOffset = .zero }
            }
    }

    private var panGesture: some Gesture {
        DragGesture(minimumDistance: 22)
            .onChanged { value in
                guard scale > 1 else { return }
                offset = CGSize(
                    width: lastOffset.width + value.translation.width,
                    height: lastOffset.height + value.translation.height
                )
            }
            .onEnded { _ in lastOffset = offset }
    }

    private func aspectFitRect(imageSize: CGSize, in container: CGSize) -> CGRect {
        guard imageSize.width > 0, imageSize.height > 0 else { return .zero }
        let ratio = min(container.width / imageSize.width, container.height / imageSize.height)
        let size = CGSize(width: imageSize.width * ratio, height: imageSize.height * ratio)
        return CGRect(
            x: (container.width - size.width) / 2,
            y: (container.height - size.height) / 2,
            width: size.width,
            height: size.height
        )
    }

    private func displayRect(for visionRect: CGRect, imageRect: CGRect) -> CGRect {
        CGRect(
            x: imageRect.minX + visionRect.minX * imageRect.width,
            y: imageRect.minY + (1 - visionRect.maxY) * imageRect.height,
            width: visionRect.width * imageRect.width,
            height: visionRect.height * imageRect.height
        )
    }
}
