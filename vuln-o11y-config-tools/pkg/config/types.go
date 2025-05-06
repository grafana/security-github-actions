package config

// VulnerabilityConfig is the root of the file (`version`, `project`, `sources`).
type VulnerabilityConfig struct {
	Version string  `yaml:"version"  json:"version"`
	Project Project `yaml:"project"  json:"project"`
	Sources Sources `yaml:"sources"  json:"sources"`
}

/* -------------------------------------------------------------------------- */
/*  Project section                                                           */
/* -------------------------------------------------------------------------- */

type Project struct {
	Name   string  `yaml:"name"   json:"name"`
	Owners []Owner `yaml:"owners" json:"owners"`
}

type Owner struct {
	Type   string `yaml:"type"   json:"type"`
	Team   string `yaml:"team,omitempty"   json:"team,omitempty"`   // for github / tanka teams
	Name   string `yaml:"name,omitempty"   json:"name,omitempty"`   // for individual owners
	GitHub string `yaml:"github,omitempty" json:"github,omitempty"` // for individual owners
}

/* -------------------------------------------------------------------------- */
/*  Sources section                                                           */
/* -------------------------------------------------------------------------- */

type Sources struct {
	Repository *RepositorySource  `yaml:"repository,omitempty" json:"repository,omitempty"`
	Containers []*ContainerSource `yaml:"containers,omitempty" json:"containers,omitempty"`
}

/* ---------- Repository source -------------------------------------------- */

type RepositorySource struct {
	Name         string                 `yaml:"name"         json:"name"` // includes organization name
	Groups       []string               `yaml:"groups,omitempty" json:"groups,omitempty"`
	ScanSettings RepositoryScanSettings `yaml:"scanSettings" json:"scanSettings"`
	ScanStrategy ScanStrategy           `yaml:"scanStrategy" json:"scanStrategy"`
	Owners       []Owner                `yaml:"owners" json:"owners"`
}

type RepositoryScanSettings struct {
	ScanMainBranch bool     `yaml:"scanMainBranch" json:"scanMainBranch"`
	AutoArchive    bool     `yaml:"autoArchive"    json:"autoArchive"`
	ExcludedPaths  []string `yaml:"excludedPaths,omitempty" json:"excludedPaths,omitempty"`
}

/* ---------- Container source --------------------------------------------- */

type ContainerSource struct {
	Name         string                `yaml:"name"     json:"name"`
	Registry     string                `yaml:"registry" json:"registry"`
	Groups       []string              `yaml:"groups,omitempty" json:"groups,omitempty"`
	ScanSettings ContainerScanSettings `yaml:"scanSettings" json:"scanSettings"`
	ScanStrategy ScanStrategy          `yaml:"scanStrategy" json:"scanStrategy"`
	Owners       []Owner               `yaml:"owners" json:"owners"`
}

type ContainerScanSettings struct {
	AutoArchive      bool     `yaml:"autoArchive"      json:"autoArchive"`
	ExcludedPatterns []string `yaml:"excludedPatterns,omitempty" json:"excludedPatterns,omitempty"`
}

/* ---------- Scan-strategy types ----------------------------------- */

type ScanStrategy struct {
	Type             string            `yaml:"type"             json:"type"` // "semver" or "tagCount"
	SemverSettings   *SemverSettings   `yaml:"semverSettings,omitempty"   json:"semverSettings,omitempty"`
	TagCountSettings *TagCountSettings `yaml:"tagCountSettings,omitempty" json:"tagCountSettings,omitempty"`
}

type SemverSettings struct {
	MajorVersions int `yaml:"majorVersions" json:"majorVersions"`
	MinorVersions int `yaml:"minorVersions" json:"minorVersions"`
	PatchVersions int `yaml:"patchVersions" json:"patchVersions"`
}

type TagCountSettings struct {
	LatestTagsCount int `yaml:"latestTagsCount" json:"latestTagsCount"`
}
