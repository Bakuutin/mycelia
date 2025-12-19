import time
from typing import Dict, Any, Callable
from pydantic import BaseModel


class TestPythonIntegrationJobData(BaseModel):
    type: str = "testPythonIntegration"


def process_test_python_integration_job(
    job_id: str,
    data: TestPythonIntegrationJobData,
    progress_callback: Callable[[Dict[str, Any]], None],
) -> Dict[str, Any]:
    total_iterations = 20
    
    for i in range(total_iterations):
        progress_callback({
            "iteration": i + 1,
            "total": total_iterations,
            "progress": (i + 1) / total_iterations * 100,
        })
        
        if i < total_iterations - 1:
            time.sleep(1)
    
    return {
        "completed": True,
        "iterations": total_iterations,
    }

