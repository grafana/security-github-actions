package validate

import (
	"fmt"
	"strings"

	"github.com/go-playground/validator/v10"
)

type ValidationError struct{ Lines []string }

func (e ValidationError) Error() string { return strings.Join(e.Lines, "\n") }

func formatErrors(ve validator.ValidationErrors) error {
	lines := make([]string, len(ve))
	for i, fe := range ve {
		lines[i] = fmt.Sprintf("%s: %s", fe.Namespace(), fe.Tag())
	}
	return ValidationError{Lines: lines}
}
