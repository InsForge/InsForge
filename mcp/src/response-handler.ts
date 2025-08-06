// Helper functions to handle traditional REST response format

interface ErrorResponse {
  error: string;
  message: string;
  statusCode: number;
  nextAction?: string;
}

export async function handleApiResponse(response: any): Promise<any> {
  const responseData = await response.json();
  
  // Handle traditional REST format
  if (!response.ok) {
    // Error response
    const errorData = responseData as ErrorResponse;
    let fullMessage = errorData.message || errorData.error || 'Unknown error';
    
    // Append nextAction if available
    if (errorData.nextAction) {
      fullMessage += `. ${errorData.nextAction}`;
    }
    
    throw new Error(fullMessage);
  }
  
  // Success response - data returned directly
  return responseData;
}

export function formatSuccessMessage(operation: string, data: any): string {
  // If data contains a message, use it
  if (data && typeof data === 'object' && 'message' in data) {
    return `${data.message}\n${JSON.stringify(data, null, 2)}`;
  }
  
  // Otherwise, create a generic success message
  return `${operation} completed successfully:\n${JSON.stringify(data, null, 2)}`;
}