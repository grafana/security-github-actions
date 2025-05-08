package validate

import (
	"github.com/go-playground/validator/v10"
	"github.com/grafana/vuln-o11y-config-tools/pkg/config"
)

// ScanStrategy must have either semverSettings or tagCountSettings, but not both.
func scanStrategyRule(sl validator.StructLevel) {
	ss := sl.Current().Interface().(config.ScanStrategy)

	switch ss.Type {
	case "semver":
		if ss.SemverSettings == nil {
			sl.ReportError(ss.SemverSettings, "semverSettings", "SemverSettings", "required_when_semver", "")
		}
		if ss.TagCountSettings != nil {
			sl.ReportError(ss.TagCountSettings, "tagCountSettings", "TagCountSettings", "forbidden_when_semver", "")
		}
	case "tagCount":
		if ss.TagCountSettings == nil {
			sl.ReportError(ss.TagCountSettings, "tagCountSettings", "TagCountSettings", "required_when_tagcount", "")
		}
		if ss.SemverSettings != nil {
			sl.ReportError(ss.SemverSettings, "semverSettings", "SemverSettings", "forbidden_when_tagcount", "")
		}
	}
}

// Owner must have appropriate metadata for their type.
func ownerRule(sl validator.StructLevel) {
	own := sl.Current().Interface().(config.Owner)

	switch own.Type {
	case "github", "tanka":
		if own.Team == "" {
			sl.ReportError(own.Team, "team", "Team", "required_for_team_owner", "")
		}
	case "individual":
		if own.Name == "" {
			sl.ReportError(own.Name, "name", "Name", "required_for_individual", "")
		}
		if own.GitHub == "" {
			sl.ReportError(own.GitHub, "github", "GitHub", "required_for_individual", "")
		}
	}
}

// Project name and repository name must match
func projectRepoNameRule(sl validator.StructLevel) {
	root := sl.Current().Interface().(config.VulnerabilityConfig)

	if root.Project.Name == "" {
		sl.ReportError(root.Project.Name, "Project.Name", "Project.Name",
			"required", "")
		return
	}
	if root.Sources.Repository == nil || root.Sources.Repository.Name == "" {
		sl.ReportError(root.Sources.Repository, "Sources.Repository.Name",
			"Sources.Repository.Name", "required", "")
		return
	}
	if root.Project.Name != root.Sources.Repository.Name {
		sl.ReportError(root.Project.Name, "Project.Name", "Project.Name",
			"nefield", "Sources.Repository.Name")
	}
}
