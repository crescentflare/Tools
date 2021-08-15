import sketch from 'sketch'
// documentation: https://developer.sketchapp.com/reference/api/

// --
// Main entry
// --

export default function() {
    // Get selected layers
    const doc = sketch.getSelectedDocument()
    const selectedLayers = doc.selectedLayers

    // Show alert if no layers are selected
    if (selectedLayers.length == 0) {
        sketch.UI.alert("No layers selected", "Select a single artboard (or a layer within an artboard) to save the atlas entries as a JSON file")
        return
    }

    // Collect artboards
    var duplicateArtboards = []
    for (var i = 0; i < selectedLayers.length; i++) {
        if (selectedLayers.layers[i].type == "Artboard") {
            duplicateArtboards.push(selectedLayers.layers[i])
        } else if (selectedLayers.layers[i].getParentArtboard()) {
            duplicateArtboards.push(selectedLayers.layers[i].getParentArtboard())
        }
    }

    // Filter out duplicates
    var artboards = duplicateArtboards.filter(function(item, pos, self) {
        for (var i = 0; i < self.length; i++) {
            if (self[i].id == item.id) {
                return i == pos
            }
        }
        return false
    })

    // Abort if no artboard was found
    if (artboards.length == 0) {
        sketch.UI.alert("No artboards found", "The selected layers are not part of an artboard")
        return
    }

    // Also abort if multiple artboards were found
    if (artboards.length > 1) {
        sketch.UI.alert("Multiple artboards selected", "You can only save entries for one artboard at a time")
        return
    }

    // Prepare dialog
    var artboard = artboards[0]
    var dialog = NSSavePanel.savePanel()
    dialog.setNameFieldStringValue(artboard.name)
    dialog.allowedContentTypes = [UTType.typeWithFilenameExtension("json")]

    // Show
    if (dialog.runModal()) {
        saveFile(artboard, dialog.URL().path())
    }
}

var saveFile = function(artboard, path) {
    // Set up entries
    var entries = []
    var usedWidth = 0
    var usedHeight = 0
    for (var i = 0; i < artboard.layers.length; i++) {
        entries.push({ "identifier": artboard.layers[i].name, "x": artboard.layers[i].frame.x, "y": artboard.layers[i].frame.y, "width": artboard.layers[i].frame.width, "height": artboard.layers[i].frame.height })
        usedWidth = Math.max(usedWidth, artboard.layers[i].frame.x + artboard.layers[i].frame.width)
        usedHeight = Math.max(usedHeight, artboard.layers[i].frame.y + artboard.layers[i].frame.height)
    }

    // Save json
    var json = { "usedWidth": usedWidth, "usedHeight": usedHeight, "totalWidth": artboard.frame.width, "totalHeight": artboard.frame.height, "entries": entries }
    const string = NSString.stringWithFormat("%@", JSON.stringify(json, 0, 2))
    string.writeToFile_atomically(path, true)
}
