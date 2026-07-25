import Foundation

enum LabelSummaryService {
    private struct Heading {
        let kind: LabelSection.Kind
        let expressions: [String]
    }

    private static let headings: [Heading] = [
        Heading(kind: .activeIngredients, expressions: ["active ingredient", "active ingredients"]),
        Heading(kind: .inactiveIngredients, expressions: ["inactive ingredient", "inactive ingredients"]),
        Heading(kind: .directions, expressions: ["directions", "dosage", "how to use"]),
        Heading(kind: .warnings, expressions: ["warnings", "warning", "do not use", "ask a doctor", "stop use"]),
        Heading(kind: .uses, expressions: ["uses", "indications", "purpose"]),
        Heading(kind: .storage, expressions: ["storage", "store at", "store between", "keep at"])
    ]

    static func sections(from rawText: String) -> [LabelSection] {
        let cleaned = rawText
            .replacingOccurrences(of: "•", with: "\n• ")
            .replacingOccurrences(of: #"[ \t]+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)

        guard !cleaned.isEmpty else { return [] }

        let lines = cleaned
            .components(separatedBy: .newlines)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        var buckets: [LabelSection.Kind: [String]] = [:]
        var currentKind: LabelSection.Kind = .other

        for line in lines {
            let normalized = line.lowercased()
            if let match = headings.first(where: { heading in
                heading.expressions.contains(where: { normalized.hasPrefix($0) })
            }) {
                currentKind = match.kind
                let preserveLead = ["do not use", "ask a doctor", "stop use", "store at", "store between", "keep at"]
                    .contains(where: { normalized.hasPrefix($0) })
                let content = preserveLead ? line : removingHeading(from: line, expressions: match.expressions)
                if !content.isEmpty { buckets[currentKind, default: []].append(content) }
            } else {
                buckets[currentKind, default: []].append(line)
            }
        }

        return LabelSection.Kind.allCases.compactMap { kind in
            guard let values = buckets[kind], !values.isEmpty else { return nil }
            return LabelSection(kind: kind, content: readable(values))
        }
    }

    private static func removingHeading(from line: String, expressions: [String]) -> String {
        guard let heading = expressions.first(where: { line.lowercased().hasPrefix($0) }) else { return line }
        let index = line.index(line.startIndex, offsetBy: heading.count)
        return String(line[index...])
            .trimmingCharacters(in: CharacterSet(charactersIn: ":-–— •\t"))
    }

    private static func readable(_ lines: [String]) -> String {
        lines
            .map { line in
                var value = line.trimmingCharacters(in: .whitespacesAndNewlines)
                if value.hasPrefix("•") { value.removeFirst() }
                return value.trimmingCharacters(in: .whitespaces)
            }
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
    }
}
