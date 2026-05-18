"""Command implementations for the demo CLI."""
import os
from .util import banner


def run() -> None:
    """Entry point — prints a banner."""
    banner(os.getcwd())
