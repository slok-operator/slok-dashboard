package k8s

import (
	"fmt"
	"os"
	"path/filepath"

	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"sigs.k8s.io/controller-runtime/pkg/client"
)

func NewClient(kubeconfig string) (client.Client, error) {
	config, err := loadRESTConfig(kubeconfig)
	if err != nil {
		return nil, err
	}

	kubeClient, err := client.New(config, client.Options{Scheme: runtime.NewScheme()})
	if err != nil {
		return nil, fmt.Errorf("create controller-runtime client: %w", err)
	}

	return kubeClient, nil
}

func loadRESTConfig(kubeconfig string) (*rest.Config, error) {
	if kubeconfig != "" {
		config, err := clientcmd.BuildConfigFromFlags("", kubeconfig)
		if err != nil {
			return nil, fmt.Errorf("load kubeconfig %q: %w", kubeconfig, err)
		}
		return config, nil
	}

	config, err := rest.InClusterConfig()
	if err == nil {
		return config, nil
	}

	home, homeErr := os.UserHomeDir()
	if homeErr != nil {
		return nil, fmt.Errorf("load in-cluster config: %w", err)
	}

	defaultKubeconfig := filepath.Join(home, ".kube", "config")
	config, kubeconfigErr := clientcmd.BuildConfigFromFlags("", defaultKubeconfig)
	if kubeconfigErr != nil {
		return nil, fmt.Errorf("load in-cluster config: %w; load default kubeconfig %q: %w", err, defaultKubeconfig, kubeconfigErr)
	}

	return config, nil
}
