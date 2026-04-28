package prometheus

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/slok-operator/slok-dashboard/internal/api"
	"net/url"
	"strconv"
	"time"
)

type Client struct {
	baseURL    string
	httpClient *http.Client
}

func NewClient(baseURL string) *Client {
	return &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
	}
}

func (c *Client) Enabled() bool {
	return c != nil && c.baseURL != ""
}

func (c *Client) QueryRange(r *http.Request, query string, start time.Time, end time.Time, step time.Duration) ([]api.TimeseriesPoint, error) {
	ctx := r.Context()
	if !c.Enabled() {
		return nil, fmt.Errorf("prometheus url is not configured")
	}
	if step <= 0 {
		return nil, fmt.Errorf("step must be greater than zero")
	}

	endpoint, err := url.JoinPath(c.baseURL, "/api/v1/query_range")
	if err != nil {
		return nil, fmt.Errorf("build prometheus query_range url: %w", err)
	}

	values := url.Values{}
	values.Set("query", query)
	values.Set("start", strconv.FormatFloat(float64(start.Unix()), 'f', -1, 64))
	values.Set("end", strconv.FormatFloat(float64(end.Unix()), 'f', -1, 64))
	values.Set("step", strconv.FormatFloat(step.Seconds(), 'f', -1, 64))

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint+"?"+values.Encode(), nil)
	if err != nil {
		return nil, fmt.Errorf("create prometheus request: %w", err)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("query prometheus: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("prometheus query failed: %s", resp.Status)
	}

	var payload queryRangeResponse
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode prometheus response: %w", err)
	}
	if payload.Status != "success" {
		return nil, fmt.Errorf("prometheus query status: %s", payload.Status)
	}
	if len(payload.Data.Result) == 0 {
		return []api.TimeseriesPoint{}, nil
	}

	points := make([]api.TimeseriesPoint, 0, len(payload.Data.Result[0].Values))
	for _, sample := range payload.Data.Result[0].Values {
		if len(sample) != 2 {
			continue
		}
		timestamp, ok := numberFromAny(sample[0])
		if !ok {
			continue
		}
		valueString, ok := sample[1].(string)
		if !ok {
			continue
		}
		value, err := strconv.ParseFloat(valueString, 64)
		if err != nil {
			continue
		}
		points = append(points, api.TimeseriesPoint{Timestamp: time.Unix(int64(timestamp), 0), Value: value})
	}

	return points, nil
}

type queryRangeResponse struct {
	Status string `json:"status"`
	Data   struct {
		Result []struct {
			Values [][]any `json:"values"`
		} `json:"result"`
	} `json:"data"`
}

func numberFromAny(value any) (float64, bool) {
	switch typed := value.(type) {
	case float64:
		return typed, true
	case string:
		parsed, err := strconv.ParseFloat(typed, 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}
