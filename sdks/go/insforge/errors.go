package insforge

import "fmt"

// InsForgeError is returned by all SDK operations on failure.
type InsForgeError struct {
	Message     string `json:"message"`
	StatusCode  int    `json:"statusCode"`
	Code        string `json:"error"`
	NextActions string `json:"nextActions,omitempty"`
}

func (e *InsForgeError) Error() string {
	if e.Code != "" {
		return fmt.Sprintf("InsForgeError[%d %s]: %s", e.StatusCode, e.Code, e.Message)
	}
	return fmt.Sprintf("InsForgeError[%d]: %s", e.StatusCode, e.Message)
}

func newError(message, code string, statusCode int) *InsForgeError {
	return &InsForgeError{Message: message, StatusCode: statusCode, Code: code}
}

func errorFromBody(body map[string]interface{}, statusCode int) *InsForgeError {
	errField, _ := body["error"]
	switch v := errField.(type) {
	case map[string]interface{}:
		msg, _ := v["message"].(string)
		code, _ := v["code"].(string)
		details, _ := v["details"].(string)
		return &InsForgeError{Message: msg, StatusCode: statusCode, Code: code, NextActions: details}
	case string:
		return &InsForgeError{Message: v, StatusCode: statusCode}
	default:
		return &InsForgeError{Message: fmt.Sprintf("%v", body), StatusCode: statusCode}
	}
}
