package config

// VulnerabilityConfig is the root of the file
type VulnerabilityConfig struct {
	Version string  `yaml:"version" validate:"required"`
	Project Project `yaml:"project" validate:"required,dive"`
	Sources Sources `yaml:"sources" validate:"required,dive"`
}

/* -------------------------------------------------------------------------- */
/*  Project section                                                           */
/* -------------------------------------------------------------------------- */

type Project struct {
	Name   string  `yaml:"name"   validate:"required"`
	Owners []Owner `yaml:"owners" validate:"required,min=1,dive"` // ≥1 owner
}

type Owner struct {
	Type   string `yaml:"type"   validate:"required,oneof=github tanka individual"`
	Team   string `yaml:"team,omitempty"`
	Name   string `yaml:"name,omitempty"`
	GitHub string `yaml:"github,omitempty"`
}

/* -------------------------------------------------------------------------- */
/*  Sources section                                                           */
/* -------------------------------------------------------------------------- */

type Sources struct {
	Repository *RepositorySource  `yaml:"repository,omitempty" validate:"required,dive"`
	Containers []*ContainerSource `yaml:"containers,omitempty" validate:"omitempty,min=1,dive"`
}

/* ---------- Repository source -------------------------------------------- */

type RepositorySource struct {
	Name         string                 `yaml:"name"         validate:"required"`
	Groups       []string               `yaml:"groups,omitempty"`
	ScanSettings RepositoryScanSettings `yaml:"scanSettings" validate:"dive"`
	ScanStrategy ScanStrategy           `yaml:"scanStrategy" validate:"required,dive"`
	Owners       []Owner                `yaml:"owners"       validate:"required,min=1,dive"`
}

type RepositoryScanSettings struct {
	ScanMainBranch bool     `yaml:"scanMainBranch"`
	AutoArchive    bool     `yaml:"autoArchive"`
	ExcludedPaths  []string `yaml:"excludedPaths,omitempty"`
}

/* ---------- Container source --------------------------------------------- */

type ContainerSource struct {
	Name         string                `yaml:"name"     validate:"required"`
	Registry     string                `yaml:"registry" validate:"required"`
	Groups       []string              `yaml:"groups,omitempty"`
	ScanSettings ContainerScanSettings `yaml:"scanSettings" validate:"dive"`
	ScanStrategy ScanStrategy          `yaml:"scanStrategy" validate:"required,dive"`
	Owners       []Owner               `yaml:"owners"       validate:"required,min=1,dive"`
}

type ContainerScanSettings struct {
	AutoArchive      bool     `yaml:"autoArchive"`
	ExcludedPatterns []string `yaml:"excludedPatterns,omitempty"`
}

/* ---------- Scan-strategy types ----------------------------------- */

type ScanStrategy struct {
	Type             string            `yaml:"type" validate:"required,oneof=semver tagCount"`
	SemverSettings   *SemverSettings   `yaml:"semverSettings,omitempty"`
	TagCountSettings *TagCountSettings `yaml:"tagCountSettings,omitempty"`
}

type SemverSettings struct {
	MajorVersions int `yaml:"majorVersions" validate:"required,gte=0"`
	MinorVersions int `yaml:"minorVersions" validate:"required,gte=0"`
	PatchVersions int `yaml:"patchVersions" validate:"required,gte=0"`
}

type TagCountSettings struct {
	LatestTagsCount int `yaml:"latestTagsCount" validate:"required,gte=1,lte=100"`
}
