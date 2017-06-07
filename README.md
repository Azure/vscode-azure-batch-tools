# Azure Batch Tools for Visual Studio Code

A [Visual Studio Code](https://code.visualstudio.com/) extension for working with [Azure Batch](https://azure.microsoft.com/services/batch/).

## Status

This is early-stage work in progress.  The happy paths should work okay, but the error paths haven't really been tested, and are likely to produce mediocre error messages at best!  And it hasn't yet been tested at all on Mac or Linux.  Please do raise issues for anything which is missing (plenty of that!), broken or unpolished.

# Prerequisites

This extension depends on the [Azure CLI 2.0](https://docs.microsoft.com/en-us/cli/azure/overview) and the [Azure Batch CLI extensions](https://github.com/Azure/azure-batch-cli-extensions).  Before running this VS Code extension, you must install both of these, *and* must log in to Azure (`az login`) and to a Batch account (`az batch account login`).  (At the moment, the VS Code extension doesn't provide any interactive support for installation or login, though you can run the login commands through the VS Code Terminal window.  If you install the CLI but not the Batch extensions, you may get weird errors!)

# Commands

All commands are in the 'Azure' category.

* **Azure: Create Batch Job:** Creates an Azure Batch job from the job template in the active tab.  (It doesn't yet support plain old job JSON.)  If the template has parameters, it will prompt for the values to use for this job.  If there is a parameters file in the same directory (named the same as the job template, but with the extension `.parameters.json`), then it will use any values in this file (but will prompt for any values not given in the file).

* **Azure: Create Batch Pool:** Similar to Create Batch Job but creates a pool from a template.  (Again, plain pool JSON is not yet supported.)

# Contributing

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.
