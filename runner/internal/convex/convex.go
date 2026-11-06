// Package convex calls the deployment's signed /runner endpoints, in convex/runner.ts.
package convex

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"time"
)

// ErrLost means the job's claim was lost: it was deleted, or reclaimed after its lease ran out.
var ErrLost = errors.New("the job is no longer ours")

// Job is a source the runner has claimed.
type Job struct {
	SourceID string `json:"sourceId"`
	Token    string `json:"token"`
	Name     string `json:"name"`
	Kind     string `json:"kind"`
	Size     int64  `json:"size"`
	FileURL  string `json:"fileUrl"`
	LeaseMS  int64  `json:"leaseMs"`
	// When the claim was asked for. Its lease started no earlier.
	Asked time.Time `json:"-"`
}

// Asset is an uploaded image the Markdown links to as asset:Name.
type Asset struct {
	Name      string `json:"name"`
	StorageID string `json:"storageId"`
}

// Client calls the deployment's /runner endpoints, signing each request.
type Client struct {
	SiteURL string
	Secret  string
	HTTP    *http.Client
}

// Sign is the hex HMAC-SHA256 that convex/runner.ts checks. The path includes any query.
func Sign(secret, timestamp, method, path string, body []byte) string {
	mac := hmac.New(sha256.New, []byte(secret))
	fmt.Fprintf(mac, "%s\n%s\n%s\n", timestamp, method, path)
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

var hexSignature = regexp.MustCompile(`^[0-9a-f]{64}$`)

// PlausiblySigned checks a request's signature headers have the right form and a recent time.
func PlausiblySigned(r *http.Request, now time.Time) bool {
	ms, err := strconv.ParseInt(r.Header.Get("X-Runner-Timestamp"), 10, 64)
	return err == nil && now.Sub(time.UnixMilli(ms)).Abs() <= 5*time.Minute &&
		hexSignature.MatchString(r.Header.Get("X-Runner-Signature"))
}

// Verify checks a signed request from Convex, such as a nudge.
func Verify(secret string, r *http.Request, body []byte, now time.Time) bool {
	if !PlausiblySigned(r, now) {
		return false
	}
	want := Sign(secret, r.Header.Get("X-Runner-Timestamp"), r.Method, r.URL.RequestURI(), body)
	return hmac.Equal([]byte(want), []byte(r.Header.Get("X-Runner-Signature")))
}

func (c *Client) call(ctx context.Context, path string, in, out any) error {
	body, err := json.Marshal(in)
	if err != nil {
		return err
	}
	return c.post(ctx, path, "application/json", body, out)
}

// post sends a signed request, decoding a JSON response into out unless it's nil.
func (c *Client) post(ctx context.Context, path, contentType string, body []byte, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.SiteURL+path, bytes.NewReader(body))
	if err != nil {
		return err
	}
	timestamp := strconv.FormatInt(time.Now().UnixMilli(), 10)
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("X-Runner-Timestamp", timestamp)
	req.Header.Set("X-Runner-Signature", Sign(c.Secret, timestamp, http.MethodPost, path, body))
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return err
	}
	switch {
	case resp.StatusCode == http.StatusConflict:
		return ErrLost
	case resp.StatusCode != http.StatusOK:
		return fmt.Errorf("%s: %s: %s", path, resp.Status, bytes.TrimSpace(data))
	case out == nil:
		return nil
	}
	return json.Unmarshal(data, out)
}

type lease struct {
	SourceID string `json:"sourceId"`
	Token    string `json:"token"`
}

func (j *Job) lease() lease { return lease{j.SourceID, j.Token} }

// Claim takes the next queued source, or returns nil if there is none.
func (c *Client) Claim(ctx context.Context) (*Job, error) {
	var out struct {
		Job *Job `json:"job"`
	}
	asked := time.Now()
	err := c.call(ctx, "/runner/claim", struct{}{}, &out)
	if out.Job != nil {
		out.Job.Asked = asked
	}
	return out.Job, err
}

func (c *Client) Heartbeat(ctx context.Context, job *Job) error {
	return c.call(ctx, "/runner/heartbeat", job.lease(), nil)
}

// Upload stores one file of the result, returning its storage ID. Only this claim can use it.
func (c *Client) Upload(ctx context.Context, job *Job, contentType string, data []byte) (string, error) {
	query := url.Values{"sourceId": {job.SourceID}, "token": {job.Token}}
	var out struct {
		StorageID string `json:"storageId"`
	}
	if err := c.post(ctx, "/runner/upload?"+query.Encode(), contentType, data, &out); err != nil {
		return "", err
	}
	if out.StorageID == "" {
		return "", fmt.Errorf("upload: no storage ID")
	}
	return out.StorageID, nil
}

// Complete saves the job's result, and what it cost, which counts against the user's limit.
func (c *Client) Complete(ctx context.Context, job *Job, markdownID string, pageCount int, assets []Asset, costUSD float64) error {
	in := struct {
		lease
		MarkdownID string  `json:"markdownId"`
		PageCount  *int    `json:"pageCount,omitempty"`
		Assets     []Asset `json:"assets"`
		CostUSD    float64 `json:"costUsd"`
	}{job.lease(), markdownID, nil, assets, costUSD}
	if pageCount > 0 {
		in.PageCount = &pageCount
	}
	if in.Assets == nil {
		in.Assets = []Asset{}
	}
	return c.call(ctx, "/runner/complete", in, nil)
}

// Fail ends the claim with a message for the user. A released job is queued
// again instead. What it cost so far counts against the user's limit either way.
func (c *Client) Fail(ctx context.Context, job *Job, message string, release bool, costUSD float64) error {
	in := struct {
		lease
		Error   string  `json:"error"`
		Release bool    `json:"release"`
		CostUSD float64 `json:"costUsd"`
	}{job.lease(), message, release, costUSD}
	return c.call(ctx, "/runner/fail", in, nil)
}

// Charge reports what a job cost whose claim was lost, so that Complete and Fail
// were refused. Convex only counts a claim's first report, so it's always safe to send.
func (c *Client) Charge(ctx context.Context, job *Job, costUSD float64) error {
	in := struct {
		lease
		CostUSD float64 `json:"costUsd"`
	}{job.lease(), costUSD}
	return c.call(ctx, "/runner/charge", in, nil)
}

// Download fetches the claimed file, refusing anything larger than it should be.
func (c *Client) Download(ctx context.Context, job *Job) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, job.FileURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("download: %s", resp.Status)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, job.Size+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) != job.Size {
		return nil, fmt.Errorf("download: got %d bytes, expected %d", len(data), job.Size)
	}
	return data, nil
}
