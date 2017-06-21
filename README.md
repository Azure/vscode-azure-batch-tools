# Azure Batch Tools for Visual Studio Code

A [Visual Studio Code](https://code.visualstudio.com/) extension for working with [Azure Batch](https://azure.microsoft.com/services/batch/).

## Status

This is early-stage work in progress.  The happy paths should work okay, but the error paths haven't really been tested, and are likely to produce mediocre error messages at best!  And it hasn't yet been tested at all on Mac or Linux.  Please do raise issues for anything which is missing (plenty of that!), broken or unpolished.

## Running the Extension

This isn't yet published in the VS Code marketplace.  To run it yourself:

* Clone the git repo.
* Run `npm install` in the working copy root.
* Open the folder in VS Code (`code .`).
* Hit F5 to run the extension in the Extension Development Host.

The extension uses VS Code 1.13 (May 2017) features so you will need that version or above.

# Prerequisites

This extension depends on the [Azure CLI 2.0](https://docs.microsoft.com/en-us/cli/azure/overview) and the [Azure Batch CLI extensions](https://github.com/Azure/azure-batch-cli-extensions).  Before running this VS Code extension, you must install both of these, *and* must log in to Azure (`az login`) and to a Batch account (`az batch account login`).  (At the moment, the VS Code extension doesn't provide any interactive support for installation or login, though you can run the login commands through the VS Code Terminal window.  If you install the CLI but not the Batch extensions, you may get weird errors!)

**Important:** The 'convenient' ways of installing Azure CLI 2.0 (e.g. the Windows MSI) _will not allow you to install the Batch Extensions_.  You need the `az component update` command to install the extensions.  You _should_ be able to use `pip install azure-cli` to install the CLI with component update support (if it doesn't work, please let the Azure CLI folks know).

# Features

* Commands for working with Azure Batch job templates and pool templates (see below)
* Snippets and auto-completion for common template elements and parameters
  * Type `batch` in a JSON file to see available snippets
* Template diagnostics
  * Warning squiggles when a template references an undeclared parameter (current status: wonky)
* Custom explorer pane displaying Azure Batch jobs and pools

# Commands

All commands are in the 'Azure' category.

* **Azure: Create Batch Job:** Creates an Azure Batch job from the job template or job JSON in the active tab.  If the active tab is a template, the command prompts for a value for each template parameter.  If there is a parameters file in the same directory (named the same as the job template, but with the extension `.parameters.json`), then it will use any values in this file (but will prompt for any values not given in the file).  Refer to [the documentation for the template and parameter file formats](https://github.com/Azure/azure-batch-cli-extensions/blob/master/doc/templates.md).

* **Azure: Create Batch Pool:** Similar to Create Batch Job but creates a pool from a template or JSON.

* **Azure: Create Batch Template from Job:** Prompts for a job in the Azure Batch account, and creates a Batch Extensions template based on that job.  You can then use the **Convert to Parameter** command to parameterise aspects of of the job.

* **Azure: Create Batch Template from Pool:** Similar to Create Batch Template from Job but creates a pool template.

* **Azure: Convert to Batch Template Parameter:** Applies to job or pool templates.  Converts the selected property to a template parameter - that is, it adds a declaration to the parameters section of the template, and sets the value of the property to be a reference to that newly created parameter.  (Of course you can then edit the parameter to change the name, description, etc.)

# Contributing

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.
