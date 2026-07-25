import Foundation

struct LabelSection: Identifiable, Equatable, Sendable {
    let id = UUID()
    let kind: Kind
    let content: String

    var title: String { kind.title }
    var symbol: String { kind.symbol }

    enum Kind: Int, CaseIterable, Sendable {
        case directions
        case activeIngredients
        case inactiveIngredients
        case warnings
        case uses
        case storage
        case other

        var title: String {
            switch self {
            case .directions: "Directions"
            case .activeIngredients: "Active ingredients"
            case .inactiveIngredients: "Inactive ingredients"
            case .warnings: "Warnings"
            case .uses: "Uses"
            case .storage: "Storage"
            case .other: "Other label information"
            }
        }

        var symbol: String {
            switch self {
            case .directions: "list.clipboard.fill"
            case .activeIngredients: "pills.fill"
            case .inactiveIngredients: "leaf.fill"
            case .warnings: "exclamationmark.triangle.fill"
            case .uses: "cross.case.fill"
            case .storage: "thermometer.medium"
            case .other: "doc.text.fill"
            }
        }
    }
}

