const fs = require('fs');

// Vulnerability data structure
class Vulnerability {
    constructor(VulnerabilityID, PkgName, InstalledVersion, FixedVersion = "", Severity) {
        this.VulnerabilityID = VulnerabilityID;
        this.PkgName = PkgName;
        this.InstalledVersion = InstalledVersion;
        this.FixedVersion = FixedVersion;
        this.Severity = Severity;
    }
}

// Parse Trivy JSON output
function parseTrivyOutput(file) {
    try {
        const data = fs.readFileSync(file, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        console.error(`Error reading file ${file}: ${err.message}`);
        process.exit(1);
    }
}

// Extract vulnerabilities into a map
function extractVulnerabilities(result) {
    const vulns = {};
    result.Results.forEach(res => {
        if (res.Vulnerabilities && Array.isArray(res.Vulnerabilities)) {
            res.Vulnerabilities.forEach(vuln => {
                const vulnKey = `${vuln.VulnerabilityID}-${vuln.PkgName}`;
                vulns[vulnKey] = new Vulnerability(vuln.VulnerabilityID, vuln.PkgName, vuln.InstalledVersion, vuln.FixedVersion, vuln.Severity);
            });
        }
    });
    return vulns;
}

// Compare vulnerabilities and return new vulnerabilities in the test file
function compareVulnerabilities(testVulns, mainVulns) {
    const newVulns = [];
    for (const key in testVulns) {
        if (!mainVulns[key]) {
            newVulns.push(testVulns[key]);
        }
    }
    return newVulns;
}

// Main function
function main() {
    if (process.argv.length < 4) {
        console.log("Usage: node trivy-diff.js <file_1> <file_2>");
        process.exit(1);
    }

    const file1 = process.argv[2];
    const file2 = process.argv[3];

    // Parse the Trivy scan results
    const mainResult = parseTrivyOutput(file1);
    const testResult = parseTrivyOutput(file2);

    // Extract vulnerabilities
    const mainVulns = extractVulnerabilities(mainResult);
    const testVulns = extractVulnerabilities(testResult);

    // Compare vulnerabilities
    const newVulns = compareVulnerabilities(testVulns, mainVulns);

    // Output new vulnerabilities as JSON
    if (newVulns.length === 0) {
        console.log("No new vulnerabilities found.");
    } else {
        console.log(JSON.stringify(newVulns, null, 2));
    }
}

// Run the main function
main();
