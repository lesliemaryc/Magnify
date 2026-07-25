import SwiftUI

struct SummaryView: View {
    let sections: [LabelSection]

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 14) {
                if sections.isEmpty {
                    ContentUnavailableView(
                        "No summary available",
                        systemImage: "text.magnifyingglass",
                        description: Text("Try taking a clearer photo with the full label visible.")
                    )
                    .padding(.top, 70)
                } else {
                    ForEach(sections) { section in
                        SummaryCard(section: section)
                    }

                    Label {
                        Text("Always follow the original package and your clinician’s advice. MagMed can misread small print.")
                    } icon: {
                        Image(systemName: "info.circle.fill")
                    }
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 8)
                    .padding(.top, 4)
                }
            }
            .padding(16)
        }
        .background(Color.magMedCanvas)
    }
}

private struct SummaryCard: View {
    let section: LabelSection
    @State private var isExpanded = true

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.2)) { isExpanded.toggle() }
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: section.symbol)
                        .font(.title3)
                        .foregroundStyle(section.kind == .warnings ? .orange : Color.magMedTeal)
                        .frame(width: 28)
                    Text(section.title)
                        .font(.title3.weight(.bold))
                        .foregroundStyle(Color.magMedNavy)
                    Spacer()
                    Image(systemName: "chevron.down")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .rotationEffect(.degrees(isExpanded ? 0 : -90))
                }
                .contentShape(Rectangle())
                .padding(18)
            }
            .buttonStyle(.plain)

            if isExpanded {
                Divider().padding(.horizontal, 18)
                Text(section.content)
                    .font(.body)
                    .foregroundStyle(.primary)
                    .lineSpacing(6)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(18)
            }
        }
        .background(Color.white, in: RoundedRectangle(cornerRadius: 20))
        .overlay {
            RoundedRectangle(cornerRadius: 20)
                .stroke(section.kind == .warnings ? Color.orange.opacity(0.28) : Color.black.opacity(0.05))
        }
        .shadow(color: Color.magMedNavy.opacity(0.07), radius: 10, y: 4)
    }
}

