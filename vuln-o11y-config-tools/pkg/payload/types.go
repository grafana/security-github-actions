package payload

import "github.com/grafana/vuln-o11y-config-tools/pkg/config"

type ScanOrchestratorRequest struct {
	Type       string                           `json:"type"` // container, repository
	Repository *config.RepositorySource         `json:"repository,omitempty"`
	Container  *config.ContainerSource          `json:"container,omitempty"`
	Metadata   *ScanOrchestratorRequestMetadata `json:"metadata,omitempty"`
}

type ScanOrchestratorRequestMetadata struct {
	Project *config.Project `json:"project,omitempty"`
	K8s     *K8s            `json:"k8s,omitempty"`
}

type K8s struct {
	Cluster   string `json:"cluster,omitempty"`
	Namespace string `json:"namespace,omitempty"`
}
