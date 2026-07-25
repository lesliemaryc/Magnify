import XCTest
@testable import MagMed

final class LabelSummaryServiceTests: XCTestCase {
    func testOrganizesCommonDrugFactsHeadings() {
        let text = """
        Uses
        temporarily relieves minor pain
        Warnings
        Do not use more than directed
        Directions
        adults: take 2 tablets
        Active ingredient
        Acetaminophen 500 mg
        Inactive ingredients
        starch, cellulose
        Storage
        store at 20–25°C
        """

        let sections = LabelSummaryService.sections(from: text)

        XCTAssertEqual(sections.first(where: { $0.kind == .directions })?.content, "adults: take 2 tablets")
        XCTAssertEqual(sections.first(where: { $0.kind == .activeIngredients })?.content, "Acetaminophen 500 mg")
        XCTAssertTrue(sections.first(where: { $0.kind == .warnings })?.content.contains("Do not use") == true)
        XCTAssertEqual(sections.first(where: { $0.kind == .storage })?.content, "store at 20–25°C")
    }

    func testPreservesUnknownTextInOtherSection() {
        let sections = LabelSummaryService.sections(from: "LOT 123\nEXP 08/2028")
        XCTAssertEqual(sections.count, 1)
        XCTAssertEqual(sections[0].kind, .other)
        XCTAssertEqual(sections[0].content, "LOT 123\nEXP 08/2028")
    }
}

