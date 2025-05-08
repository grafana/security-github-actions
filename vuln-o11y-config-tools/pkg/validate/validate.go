package validate

import (
	"fmt"

	"github.com/go-playground/validator/v10"
	"github.com/grafana/vuln-o11y-config-tools/pkg/config"
)

var v = newValidator()

// Validate returns error if any rule fails.
func Validate(cfg *config.VulnerabilityConfig) error {
	if cfg.Version != "1.0" {
		return fmt.Errorf("unsupported config version: %s", cfg.Version)
	}

	// Validate the config
	if err := v.Struct(cfg); err != nil {
		if ve, ok := err.(validator.ValidationErrors); ok {
			return formatErrors(ve)
		}
		return err
	}
	return nil
}

func newValidator() *validator.Validate {
	v := validator.New()

	// Custom validation rules
	v.RegisterStructValidation(scanStrategyRule, &config.ScanStrategy{})
	v.RegisterStructValidation(ownerRule, &config.Owner{})
	v.RegisterStructValidation(projectRepoNameRule, &config.VulnerabilityConfig{})
	return v
}
