import os
import sys
import requests
import json

def env(name):
    value = os.environ.get(name)
    if not value:
        print(f"Error: Environment variable {name} is not set.", file=sys.stderr)
        sys.exit(1)
    return value

class PortainerClient:
    def __init__(self, portainer_url, api_key):
        self.portainer_url = portainer_url
        self.headers = {"X-API-Key": api_key, "Content-Type": "application/json"}
    
    def _make_request(self, method, endpoint, **kwargs):
        """Make HTTP request with common error handling"""
        url = f"{self.portainer_url}{endpoint}"
        try:
            response = requests.request(method, url, headers=self.headers, **kwargs)
            response.raise_for_status()
            return response
        except requests.exceptions.RequestException as e:
            print(f"HTTP request failed: {e}", file=sys.stderr)
            if hasattr(e, 'response') and e.response is not None:
                print(f"Response body: {e.response.text}", file=sys.stderr)
            sys.exit(1)
    
    def get_stacks(self):
        """Get all stacks"""
        response = self._make_request("GET", "/api/stacks", timeout=30)
        return response.json()
    
    def get_stack_id(self, stack_name):
        """Get stack ID by name, returns None if not found"""
        stacks = self.get_stacks()
        for stack in stacks:
            if stack["Name"] == stack_name:
                return stack["Id"]
        return None
    
    def get_stack_details(self, stack_id):
        """Get stack details by ID"""
        response = self._make_request("GET", f"/api/stacks/{stack_id}", timeout=30)
        return response.json()
    
    def create_stack(self, stack_name, swarm_id, endpoint_id, stack_file_content):
        """Create a new stack"""
        payload = {
            "Name": stack_name,
            "SwarmID": swarm_id,
            "StackFileContent": stack_file_content,
            "method": "string",
            "type": "swarm",
        }
        
        response = self._make_request(
            "POST", 
            f"/api/stacks/create/swarm/string?endpointId={endpoint_id}",
            data=json.dumps(payload),
            timeout=60
        )
        result = response.json()
        print(f"Stack '{stack_name}' created successfully with ID: {result.get('Id')}")
        return result.get('Id')
    
    def update_stack(self, stack_id, endpoint_id, payload):
        """Update an existing stack"""
        self._make_request(
            "PUT",
            f"/api/stacks/{stack_id}?endpointId={endpoint_id}",
            data=json.dumps(payload),
            timeout=60
        )
        print("Stack update request sent to Portainer successfully.")

def render_docker_compose():
    with open("docker-compose.yml", "r") as f:
        content = f.read()
    
    for key, value in os.environ.items():
        content = content.replace(f"${{{key}}}", value)
    
    return content

def main():
    portainer_url = env("PORTAINER_URL")
    api_key = env("PORTAINER_API_KEY")
    stack_name = env("STACK_NAME")
    endpoint_id = env("PORTAINER_ENDPOINT_ID")
    swarm_id = env("PORTAINER_SWARM_ID")
    
    print(f"Starting redeployment for stack: {stack_name}")
    
    try:
        client = PortainerClient(portainer_url, api_key)
        stack_file_content = render_docker_compose()

        print("Rendered docker-compose.yml:")
        print(stack_file_content)
        
        stack_id = client.get_stack_id(stack_name)
        
        if stack_id is None:
            print(f"Stack '{stack_name}' not found. Creating new stack...")
            client.create_stack(stack_name, swarm_id, endpoint_id, stack_file_content)
        else:
            print(f"Found existing stack with ID: {stack_id}")
            stack_details = client.get_stack_details(stack_id)
            
            update_payload = {
                "StackFileContent": stack_file_content,
                "Env": stack_details.get("Env", []),
                "Prune": True,
                "PullImage": True,
            }
            
            client.update_stack(stack_id, endpoint_id, update_payload)
            
    except Exception as e:
        print(f"An unexpected error occurred: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main() 
