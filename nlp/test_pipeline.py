import unittest
from pathlib import Path

from pipeline import analyze

SAMPLE = (Path(__file__).parent / "sample_report.txt").read_text()
KEYS = {"document_type", "report_date", "plain_language_summary", "clinical_story", "key_findings", "timeline",
        "tests_and_treatments", "concerns_to_discuss", "questions_for_clinician", "limitations", "confidence"}


class PipelineTest(unittest.TestCase):
    def test_matches_llm_output_shape(self):
        self.assertEqual(set(analyze(SAMPLE)), KEYS)

    def test_flags_out_of_range_lab(self):
        report = analyze(SAMPLE)
        status = {f["title"].split(":")[0]: f["status"] for f in report["key_findings"]}
        self.assertEqual(status["Hemoglobin"], "abnormal")
        self.assertEqual(status["Platelet Count"], "normal")
        self.assertEqual(report["key_findings"][0]["evidence"]["page"], 1)

    def test_negation(self):
        finding = analyze("No evidence of anemia.")["key_findings"][0]
        self.assertEqual(finding["status"], "normal")


if __name__ == "__main__":
    unittest.main()
