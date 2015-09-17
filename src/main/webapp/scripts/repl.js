"use strict";

var markers = [];
var bindings = [];

var github;
var selectedGist;
var selectedExample;
var fileDeleted;
var spinCount = 0;
var closePopups = undefined;

var wrappedTag = "//$webrun_wrapped\n";
var codePrefix = "shared void run() {\n";
var codePostfix = "\n}";

var modulePrefix = "module web_ide_script \"1.0.0\" {\n";
var modulePostfix = "\n}";
var defaultImportSrc = modulePrefix +
		"    // Add module imports here" + 
		modulePostfix;

var uri = new URI();
var uriparams = uri.search(true);

var live_tc = {
    _timeout: 3000,
    _status: "disabled",
    _last: Date.now(),
    _files: null,
    shouldTypecheck: function(files) {
        if (live_tc._status == "ready" && Date.now()-live_tc._last > live_tc._timeout) {
            var files = getCompilerFiles();
            if (!$.isEmptyObject(files)) {
                return JSON.stringify(files) != live_tc._files;
            }
        }
        return false;
    },
    ready: function() {
        live_tc._status = "ready";
    },
    pause: function() {
        live_tc._status = "paused";
    },
    disable: function() {
        live_tc._status = "disabled";
    },
    update: function() {
        live_tc._files = JSON.stringify(getCompilerFiles());
    },
    postpone: function(files) {
        live_tc._last = Date.now();
        if (live_tc._status != "disabled") {
            live_tc.ready();
        }
    },
    done: function() {
        live_tc.update();
        live_tc.pause();
    },
    now: function() {
        live_tc._files = {};
        live_tc._last = Date.now() - live_tc._timeout - 1;
        live_tc.ready();
    }
};

var pagepath = window.location.pathname;
if (!pagepath.endsWith("/")) {
    var p = pagepath.lastIndexOf("/");
    pagepath = pagepath.substring(0, p + 1);
}

$(document).ready(function() {
    $('form').submit(false);
    
    var auth;
    var token = $.cookie("githubauth");
    if (token != null && !("noauth" in uriparams)) {
        auth = new Authentication({
            type: "oauth",
            token: token
        });
    }
    github = new GitHub({
        beforeSend: startSpinner,
        complete: stopSpinner,
        authentication: auth,
        debug: false
    });

    // Prevent default CTRL+D and CTRL+S used by the editor
    $(document).bind('keydown', function(e) {
        if(e.ctrlKey && (e.which == 68 || e.which == 83)) {
            e.preventDefault();
            return false;
        }
    });

    // Create the main layout
    var pstyle = 'border: 1px solid #dfdfdf; padding: 0px;';
    var zstyle = 'border: 1px solid #dfdfdf; padding: 0px; overflow: hidden;';
    
    $('#editortabs').w2tabs({
        name: 'editortabs',
        tabs: [],
        onClick: function(event) {
            selectEditor(event.target);
        }
    });
    
    $('#all').w2layout({
        name: 'all',
        padding: 4,
        panels: [
            { type: 'top', size: 102, style: zstyle, content: 'top' },
            { type: 'main', minSize: 100, style: zstyle, content: 'main',
                toolbar: {
                    items: [
                        { type: 'menu',  id: 'menu', hint: 'Manage your code', icon: 'fa fa-bars',
                            items: getMenuItems()
                        },
                        { type: 'break',  id: 'break0' },
                        { type: 'button',  id: 'run',  caption: 'Run', hint: 'Compile & execute', icon: 'fa fa-play' },
                        { type: 'button',  id: 'stop',  caption: 'Stop', hint: 'Stop program', icon: 'fa fa-stop', disabled: true },
                        { type: 'button',  id: 'reset',  caption: 'Reset', hint: 'Clear output & errors', icon: 'fa fa-exclamation' },
                        { type: 'button',  id: 'share',  caption: 'Share', hint: 'Share the code on GitHub', icon: 'fa fa-share' },
                        { type: 'break',  id: 'break1' },
                        { type: 'check',  id: 'advanced',  caption: 'Advanced', hint: 'Enable more complex code constructs', icon: 'fa fa-square-o', checkicon: 'fa fa-check-square-o', uncheckicon: 'fa fa-square-o' },
                        { type: 'spacer' },
                        { type: 'button',  id: 'help',  caption: 'Help', hint: 'Help on how this Web IDE works', icon: 'fa fa-question' },
                        { type: 'button',  id: 'connect',  caption: 'Connect', hint: 'Connect to GitHub', icon: 'fa fa-github', hidden: isGitHubConnected() },
                        { type: 'menu',   id: 'connected', caption: 'Connected', hint: 'Connected to GitHub', icon: 'fa fa-github', hidden: !isGitHubConnected(),
                            items: [
                                { text: 'Disconnect from GitHub', id: 'disconnect', icon: 'fa fa-scissors' }
                            ]
                        },
                    ],
                    onClick: function (event) {
                        if (event.target == "run") {
                            performRun();
                        } else if (event.target == "stop") {
                            stop();
                        } else if (event.target == "reset") {
                            doReset();
                        } else if (event.target == "share") {
                            shareSource();
                        } else if (event.target == "advanced") {
                            handleAdvanced(event);
                        } else if (event.target == "help") {
                            handleHelpClick();
                        } else if (event.target == "connect") {
                            handleGitHubConnect();
                        } else if (event.target == "connected:disconnect") {
                            handleGitHubDisconnect();
                        } else if (event.target == "menu:newfile") {
                            handleNewFile();
                        } else if (event.target == "menu:renamefile") {
                            handleRenameFile();
                        } else if (event.target == "menu:deletefile") {
                            handleDeleteFile();
                        } else if (event.target == "menu:new") {
                            handleNewProject();
                        } else if (event.target == "menu:rename") {
                            handleRenameGist();
                        } else if (event.target == "menu:saveall") {
                            updateSource();
                        } else if (event.target == "menu:saveas") {
                            handleSaveAs();
                        } else if (event.target == "menu:delete") {
                            handleDeleteGist();
                        }
                    }
                }
            },
            { type: 'preview', size: 200, minSize: 100, resizable: true, style: zstyle, title: 'Program output', content: 'preview' },
            { type: 'right', size: 260, minSize: 200, resizable: true, style: pstyle, content: 'right' },
            { type: 'bottom', size: 67, style: zstyle, content: 'bottom' }
        ]
    });
    
    // Now fill the layout with the elements hidden on the page
    w2ui["all"].content("top", jqContent($("#header-bar")));
    w2ui["all"].content("main", jqContent($("#core-page")));
    w2ui["all"].content("preview", jqContent($("#output")));
    w2ui["all"].content("right", jqContent($("#sidebar")));
    w2ui["all"].content("bottom", jqContent($("#footer-bar")));
    
    $('#share_src').show();
    $('#save_src').hide();
    $('#update_src').hide();
    $('#gistname').hide();
    $('#shareurl').hide();
    $('#gistlink').hide();
    $('#deletegist').hide();

    if ("usrlow" in uriparams) {
        // With "usrlow" set the user's gists will be shown
        // at the bottom of the sidebar instead of the top
        addExamplesContainer();
        addUserGistsContainer();
    } else {
        addUserGistsContainer();
        addExamplesContainer();
    }
    
    addExamples();
    
    if (uriparams.src != null) {
        // Code is directly in URL
        var code = decodeURIComponent(uriparams.src);
        editSource(code);
    } else if (uriparams.sample != null) {
        // Retrieve code from the given sample id
        editExample(uriparams.sample);
    } else if (uriparams.gist != null) {
        // Retrieve code from the given sample id
        editGist(uriparams.gist);
    } else {
        editExample('hello_world');
        window.outputReady = function() {
            startSpinner();
        	runCode('print("Ceylon ``language.version`` \\"``language.versionName``\\"");');
            stopSpinner();
        };
    }
    
    listGists();
    
    setupLiveTypechecker();
});

function jqContent(jqElem) {
    return {
        render: function() {
            $(this.box).empty();
            $(this.box).append(jqElem);
        }
    }
}

function getMenuItems() {
    var cnt = getEditors().length;
    var hasGist = (selectedGist != null);
    return [
        { text: 'New File...', id: 'newfile', icon: 'fa fa-file-o' },
        { text: 'Rename File...', id: 'renamefile', icon: 'fa fa-pencil', disabled: (cnt == 0) },
        { text: 'Delete File', id: 'deletefile', icon: 'fa fa-file-excel-o', disabled: (cnt == 0) },
        { text: 'New Project...', id: 'new', icon: 'fa fa-files-o' },
        { text: 'Rename Project...', id: 'rename', icon: 'fa fa-pencil', disabled: !hasGist, hidden: !isGitHubConnected() },
        { text: 'Save All', id: 'saveall', icon: 'fa fa-floppy-o', disabled: !hasGist || (cnt == 0) || !isAnyEditorDirty(), hidden: !isGitHubConnected() },
        { text: 'Save As...', id: 'saveas', icon: 'fa fa-files-o', disabled: (cnt == 0) },
        { text: 'Delete Project', id: 'delete', icon: 'fa fa-trash-o', disabled: !hasGist, hidden: !isGitHubConnected() },
    ];
}

function updateMenuState() {
    w2ui["all"].get("main").toolbar.set("menu", { items: getMenuItems() });
}

function handleHelpClick() {
    $('#tb_all_main_toolbar_item_help').w2overlay({ html: $('#help-message').html() });
}

function isGitHubConnected() {
    return ($.cookie("githubauth") != null);
}

// Return "Connect" or "Disconnect" depending on current state
function getGitHubButtonLabel() {
    if (!isGitHubConnected()) {
        return "Connect";
    } else {
        return "Connected";
    }
}

function handleGitHubConnect() {
    if (!isGitHubConnected()) {
        var redirect = window.location.origin + pagepath + "githubauth";
        var url = "https://github.com/login/oauth/authorize?client_id=" + clientid + "&scope=gist&state=xyz&redirect_uri=" + encodeURIComponent(redirect);
        window.open(url, "githubauth");
    }
}

function handleGitHubDisconnect() {
    if (isGitHubConnected()) {
        $.removeCookie('githubauth', { path: '/' });
        window.location.reload();
    }
}

function setupLiveTypechecker() {
    window.setInterval(function(){
        if (live_tc.shouldTypecheck()) {
            console.log("typechecking...");
            live_tc.pause();
            $.ajax('translate', {
                cache: false,
                type: 'POST',
                dataType: 'json',
                timeout: 5000,
                success: function(json, status, xhr) {
                    live_tc.done();
                    clearEditMarkers();
                    var errs = json['errors'];
                    if (errs && !$.isEmptyObject(errs)) {
                        showErrors(errs, false);
                    }
                },
                error: function() {
                    live_tc.done();
                },
                contentType: 'application/json; charset=UTF-8',
                data: JSON.stringify({
                    tc: 1,
                    files: getCompilerFiles()
                })
            });
        }
    },1000);
}

// autocompletion support
function complete(editor){
	var cursor = editor.getCursor();
    var code = getEditCode();
    live_tc.pause();
    jQuery.ajax('assist', {
        cache:false, type:'POST',
        dataType:'json',
        timeout:20000,
        beforeSend: startSpinner,
        success: function(json, status, xhr){
        	stopSpinner();
            live_tc.ready();
        	CodeMirror.autocomplete(editor, function(){
        		return {
        			list: json.opts,
        			from: cursor,
        			to: cursor
        		};
        	});
        },
        error:function(xhr, status, err) {
        	stopSpinner();
            live_tc.ready();
            w2alert("An error occurred while compiling your code: " + err?err:status, "Error");
        },
        contentType:'application/x-www-form-urlencoded; charset=UTF-8',
        data: { 
        	ceylon:code,
        	r: cursor.line+2,
        	c: cursor.ch-1
        }
    });
}

// Mark the given Gist as selected and updates the proper GUI elements
function selectGist(gist) {
    selectedGist = gist;
    selectedExample = null;
    markGistSelected(gist);
    updateMenuState();
    updateAdvancedState();
}

// Clear selected Gist
function clearGist(gist) {
    selectedGist = null;
    clearListSelectState();
    updateMenuState();
    updateAdvancedState();
}

function clearListSelectState() {
    $("#sidebar #yrcode li").removeClass("selected");
    $("#sidebar #examples li").removeClass("selected");
}

function markGistSelected(gist) {
    clearListSelectState();
    $("#sidebar #yrcode li#gist_" + gist.data.id).addClass("selected");
}

function markExampleSelected(name) {
    clearListSelectState();
    $("#sidebar #examples li#example_" + name).addClass("selected");
}

// Asks the user for a name and stores the code on the server
// Is called when the "Save As" menu item is selected
function handleSaveAs() {
    w2prompt("Enter a name for the new Gist", "Name", "", "Save As", function(name) {
        if (name != null && name != "") {
            saveSource(name);
        }
    });
}

// Stores the code by creating a new Gist on the server
function saveSource(title) {
    function onSuccess(gist) {
        clearEditorDirtyStates();
        selectGist(gist);
        createComment(gist);
        updateGists();
    }
    function onError(xhr, status, err) {
        printError("Error storing Gist: " + (err?err:status));
    }
    var files = getGistFiles();
    var data = {
        "description": "Ceylon Web Runner: " + title,
        "public": true,
        "files": files
    };
    github.createGist({
        data: data,
        success: onSuccess,
        error: onError
    });
}

// Creates the proper "files" element necessary for creating and
// updating Gists using the contents of the current editor(s)
function getGistFiles() {
    var files = {};
    var editors = getEditors();
    $.each(editors, function(index, editor) {
        var content = { content: getEditorCode(editor.ceylonId) };
        if (isEditorRenamed(editor.ceylonId)) {
            content.filename = editor.ceylonName;
            files[editor.ceylonSavedName] = content;
        } else {
            files[editor.ceylonName] = content;
        }
    });
    // See if we need to delete any files
    if (selectedGist != null) {
        $.each(selectedGist.data.files, function(index, item) {
            if (getEditor(editorId(index)) == null) {
                files[index] = null;
            }
        });
    }
    return files;
}

// Creates the proper "files" element necessary for compilation,
// autocomplete and documentation handling
function getCompilerFiles() {
    var files = {};
    var editors = getEditors();
    $.each(editors, function(index, editor) {
        if (compilerAccepts(editor.ceylonName)) {
            var content = { content: getEditorCode(editor.ceylonId) };
            files[editor.ceylonName] = content;
        }
    });
    return files;
}

// Creates a commit for the given Gist with a link to the Web Runner
function createComment(gist) {
    // Check that we have a valid GitHub token
    var token = $.cookie("githubauth");
    if (token) {
        var data = {
            "body": "[Click here](" + window.location.origin + pagepath + "?gist=" + gist.data.id + ") to run this code online",
        }
        gist.createComment({
            data: data
        });
    }
}

// Asks the user for a new name and updates the existing Gist on the server
// Is called when the "Rename" menu item is selected
function handleRenameGist() {
    var oldname = getGistName(selectedGist);
    w2prompt("Enter a new name for the current Gist", "Name", oldname, "Rename", function(name) {
        if (name != null && name != "" && name != oldname) {
            renameGist(name);
        }
    });
}

// Updates the code and or name of an existing Gist on the server
// Is called when the "Rename" button is pressed
function renameGist(title) {
    function onSuccess(gist) {
        selectGist(gist);
        updateGists();
    }
    function onError(xhr, status, err) {
        printError("Error storing Gist: " + (err?err:status));
    }
    var data = {
        "description": "Ceylon Web Runner: " + title,
    };
    selectedGist.edit({
        data: data,
        success: onSuccess,
        error: onError
    });
}

// This is a safe way to call `updateSource()` if you
// don't know if that action is allowed at this moment
function handleSaveAll() {
    if (selectedGist != null
            && (getEditors().length > 0)
            && isAnyEditorDirty()
            && isGitHubConnected()) {
        updateSource();
    }
}

// Updates the code of an existing Gist on the server
// Is called when the "Save All" button is pressed
function updateSource() {
    function onSuccess(gist) {
        clearEditorDirtyStates();
        selectGist(gist);
        updateGists();
    }
    function onError(xhr, status, err) {
        printError("Error storing Gist: " + (err?err:status));
    }
    var files = getGistFiles();
    var data = {
            "files": files
    };
    selectedGist.edit({
        data: data,
        success: onSuccess,
        error: onError
    });
}

function shareSource() {
    var weburl;
    if (selectedGist != null) {
        weburl = window.location.origin + pagepath + "?gist=" + selectedGist.data.id;
    } else {
        weburl = window.location.origin + pagepath + "?sample=" + selectedExample;
    }
    var html = '<div style="padding: 10px" class="ceylon_share_links">' +
        'Direct link to this page showing the current code:<br>' +
        '<div><input type="text" value="' + weburl + '" readonly onclick="this.select();">' +
        '<a href="' + weburl + '" target="share_webide"><i class="fa fa-external-link"></i></a></div>';
    if (selectedGist != null) {
        var githuburl = selectedGist.data.html_url;
        html += '<br><br>' +
            'Link to GitHub Gist where the current code is stored:<br>' +
            '<div><input type="text" value="' + githuburl + '" readonly onclick="this.select();">' +
            '<a href="' + githuburl + '" target="share_github"><i class="fa fa-external-link"></i></a></div>';
    }
    html += '</div>';
    $("#tb_all_main_toolbar_item_share").w2overlay(html);
}

// Deletes a Gist from the server (asks the user for confirmation first)
// Is called when the "Delete" menu item is selected
function handleNewFile() {
    var suggestion = suggestFileName();
    askFileName("New File", suggestion, true, function(newname) {
        newFile(newname);
    });
}

function newFile(name) {
    var editor;
    if (name.endsWith(".ceylon") && countCeylonFiles() >= 1) {
        // We switch to advanced mode
        applyAdvanced();
        if (name == "module.ceylon") {
            // The switch to advanced mode will have created
            // this editor already, we just select it
            editor = getEditor(editorId("module.ceylon"));
        } else {
            // We still need to create the new file
            editor = createEditor(name);
        }
    } else {
        editor = createEditor(name);
    }
    selectEditor(editor.ceylonId);
    updateEditorDirtyState(editor.ceylonId);
    updateMenuState();
    updateAdvancedState();
    return editor;
}

function newModuleFile() {
    var neweditor = addSourceEditor("module.ceylon", defaultImportSrc);
    markWrapperReadOnly(neweditor.ceylonId);
    updateEditorDirtyState(neweditor.ceylonId);
    return neweditor;
}

function handleRenameFile() {
    var id = selectedEditorId();
    var editor = getEditor(id);
    askFileName("Rename File", editor.ceylonName, false, function(newname) {
        renameFile(id, newname);
    });
}

function renameFile(id, newname) {
    var editor = getEditor(id);
    var oldname = editor.ceylonName;
    if (oldname != newname) {
        editor.ceylonName = newname;
        updateEditorDirtyState(id);
        updateMenuState();
        updateAdvancedState();
    }
}

function askFileName(title, suggestion, nodup, func) {
    var name = w2prompt('Enter the name for the file INCLUDING the extension (eg. "main.ceylon")',
        "Name",
        suggestion,
        title,
        function(name) {
            if (name != null && name != "") {
                func(name);
            }
        },
        function(form) {
            var ok = false;
            var name = form.get("value").el.value;
            if (!editorAccepts(name)) {
                form.error('The file name has to end in ".ceylon", ".js", ".md" or ".txt"');
            } else if (!/^[-_.a-zA-Z0-9]+$/.test(name)) {
                form.error('The file name can only contain letters, digits, "_", "-" and "."');
            } else if (nodup && getEditor(editorId(name)) != null) {
                form.error('A file with that name already exists');
            } else {
                ok = true;
            }
            return ok;
        }
    );
}

function suggestFileName() {
    var suggestion;
    var cnt = 1;
    do {
        suggestion = "new" + (cnt++) + ".ceylon";
    } while (getEditor(editorId(suggestion)) != null);
    return suggestion;
}

// Deletes a Gist from the server (asks the user for confirmation first)
// Is called when the "Delete" menu item is selected
function handleDeleteFile() {
    var editor = getEditor(selectedEditorId());
    w2confirm("Do you really want to delete this file '" + editor.ceylonName + "'?")
        .yes(function() {
            deleteFile(selectedEditorId());
        });
}

// Deletes a file
function deleteFile(id) {
    fileDeleted = true;
    // Remove the editor
    var div = getEditorDiv(id);
    if (div.length > 0) {
        div.remove();
        // Remove the tab
        var index = w2ui["editortabs"].get(id, true);
        w2ui["editortabs"].remove(id);
        // Select a new tab
        var editors = getEditors();
        var cnt = editors.length;
        if (cnt > 0) {
            var newindex = (index < cnt) ? index : cnt - 1;
            var newid = editors[newindex].ceylonId;
            selectEditor(newid);
        } else {
            updateMenuState();
        }
        updateAdvancedState();
    }
}

function handleNewProject() {
    checkForChangesAndRun(function() {
        newProject();
    });
}

function newProject() {
    selectedGist = null;
    selectedExample = null;
    fileDeleted = false;
    clearOutput();
    deleteEditors();
    clearListSelectState();
    newFile("main.ceylon");
}

// Deletes a Gist from the server (asks the user for confirmation first)
// Is called when the "Delete" menu item is selected
function handleDeleteGist() {
    if (selectedGist != null) {
        w2confirm("Do you really want to delete this Gist?")
            .yes(function() {
                deleteGist();
            });
    }
}

// Deletes a Gist from the server
function deleteGist() {
    function onRemove(gist) {
        doReset();
        updateGists();
    }
    selectedGist.remove({
        success: onRemove
    });
}

// Updates the user's list of available Gists
function updateGists() {
    listGists();
}

// Returns the name of the given Gist
function getGistName(gist) {
    return gist.data.description.substring(19);
}

// Shows the user's list of available Gists
function listGists(page) {
    if (github.config.authentication == null) {
        return;
    }
    
    var first = (page == null || page == 1);
    
    function showGist(gist) {
        if (first) {
            $('#yrcode').empty();
            first = false;
        }
        var desc = getGistName(gist);
        $('#yrcode').append('<li id="gist_' + gist.data.id + '" class="news_entry"><a href="#" onClick="return handleEditGist(\'' + gist.data.id + '\')">' + desc + '</a></li>');
        $('#yrcodehdr').show();
        $('#yrcode').show();
    }
    
    function acceptGist(gist) {
        if (gist.data.description.startsWith("Ceylon Web Runner: ")) {
            var show = false;
            $.each(gist.data.files, function(idx, itm) {
                if (idx.endsWith(".ceylon")) {
                    show = true;
                }
            });
            return show;
        }
        return false;
    }
    
    function handleGist(gist) {
        if (acceptGist(gist)) {
            showGist(gist);
        }
    }
    
    function onEnd(list) {
        if (list.hasMoreElements()) {
            $('#yrcodemore').click(function() { return listGists(list.pages.length + 1); });
            $('#yrcodemore').show();
        } else {
            $('#yrcodemore').hide();
        }
        if (selectedGist != null) {
            markGistSelected(selectedGist);
        }
    }
    
    // Check that we have a valid GitHub token
    var token = $.cookie("githubauth");
    if (token) {
        var gistsIter = github.gists();
        gistsIter.each({
            func: handleGist,
            finish: onEnd,
            page: page
        });
    }
}

function buttonEnable(name, enable) {
    if (enable) {
        w2ui["all"].get("main").toolbar.enable(name);
    } else {
        w2ui["all"].get("main").toolbar.disable(name);
    }
}

function buttonShow(name, show) {
    if (show) {
        w2ui["all"].get("main").toolbar.show(name);
    } else {
        w2ui["all"].get("main").toolbar.hide(name);
    }
}

function buttonSetIcon(name, icon) {
    w2ui["all"].get("main").toolbar.set(name, { icon: icon });
}

function buttonCheck(name, check) {
    var toolbar = w2ui["all"].get("main").toolbar;
    var item = toolbar.get(name);
    if (check) {
        toolbar.check(name);
        if (item.checkicon) {
            toolbar.set(name, { icon: item.checkicon });
        }
    } else {
        toolbar.uncheck(name);
        if (item.uncheckicon) {
            toolbar.set(name, { icon: item.uncheckicon });
        }
    }
}

function buttonIsChecked(name, check) {
    return w2ui["all"].get("main").toolbar.get(name).checked;
}

// Returns the number of Ceylon files that are available
// (this incldues module descriptors)
function countCeylonFiles() {
    var cnt = 0;
    var editors = getEditors();
    $.each(editors, function(index, editor) {
        if (editor.ceylonName.endsWith(".ceylon")) {
            cnt++;
        }
    });
    return cnt;
}

function handleAdvanced(event) {
    if (isAdvancedModeActive()) {
        checkForChangesAndRun(function() {
            buttonSetIcon("advanced", "fa fa-square-o");
            undoAdvanced();
        }, function() {
            buttonCheck("advanced", true);
        }, ["module.ceylon"]);
    } else {
        buttonSetIcon("advanced", "fa fa-check-square-o");
        applyAdvanced();
    }
}

function applyAdvanced() {
    var editors = getEditors();
    $.each(editors, function (index, editor) {
        editor.execCommand("selectAll");
        editor.execCommand("indentMore");
        var src = wrapCode(getEditorCode(editor.ceylonId, true), true);
        setEditorCode(editor.ceylonId, src, true);
    });
    newModuleFile();
    live_tc.ready();
    updateMenuState();
    // Need to put this in a timeout or the update
    // of the button conflicts with the w2 framework
    window.setTimeout(function () {
        updateAdvancedState();
    }, 1);
}

function undoAdvanced() {
    var tmp = fileDeleted;
    deleteFile(editorId("module.ceylon"));
    fileDeleted = tmp;
    var editors = getEditors();
    $.each(editors, function (index, editor) {
        var src = unwrapCode(getEditorCode(editor.ceylonId, true), true);
        setEditorCode(editor.ceylonId, src, true);
        editor.execCommand("selectAll");
        editor.execCommand("indentLess");
        editor.setCursor(0);
    });
    updateMenuState();
    // Need to put this in a timeout or the update
    // of the button conflicts with the w2 framework
    window.setTimeout(function () {
        updateAdvancedState();
    }, 1);
}

function isCodeUnwrappable() {
    var canUnwrap = true;
    var cnt = countCeylonFiles();
    var editors = getEditors();
    $.each(editors, function(index, editor) {
        if (editor.ceylonName.endsWith(".ceylon")
                && editor.ceylonName != "module.ceylon") {
            canUnwrap = canUnwrap && isWrapped(editor.getValue(), true);
        }
    });
    return canUnwrap && cnt <= 2;
}

function updateAdvancedState() {
    var cnt = countCeylonFiles();
    var advanced = (cnt > 1) || (cnt == 1) && isCodeUnwrappable();
    buttonCheck("advanced", advanced);
    buttonEnable("advanced", !advanced || ((cnt == 1) || (cnt == 2)) && isCodeUnwrappable());
}

function isAdvancedModeActive() {
    return buttonIsChecked("advanced");
}

// Starts the spinner indicating the system is busy.
// These can be nested, so if you call this function
// twice you will also need to call `stopSpinner()`
// twice for it to disappear
function startSpinner() {
    buttonEnable("run", false);
    buttonSetIcon("run", "fa fa-cog fa-spin");
    spinCount++;
}

// Stops the spinner indicating the system is busy
function stopSpinner() {
    spinCount--;
    if (spinCount == 0) {
        buttonEnable("run", true);
        buttonSetIcon("run", "fa fa-play");
        focusSelectedEditor();
    }
}

//Sends the code from the editor to the server for compilation and it successful, runs the resulting js.
function performRun() {
    translate(afterTranslate);
}

function createFilesFromCode(code) {
    return {
        "main.ceylon": {
            content: wrappedTag + codePrefix + code + codePostfix
        }
    };
}

//Sends the given code to the server for compilation and it successful, runs the resulting js.
function runCode(code) {
    var files = createFilesFromCode(code);
    translateCode(files, afterTranslate);
}

// Wraps the contents of the editors in an object and sends it to the server for compilation.
// On response, executes the script if compilation was OK, otherwise shows errors.
// In any case it sets the hover docs if available.
function translate(onTranslation) {
    var files = getCompilerFiles();
    if (!$.isEmptyObject(files)) {
        if (shouldCompile(files)) {
            clearEditMarkers();
            translateCode(files, onTranslation);
        } else {
            if (onTranslation) {
                onTranslation();
            }
        }
    }
}

var transok;

// Wraps the contents of the editor in an object and sends it to the server for compilation.
// On response, executes the script if compilation was OK, otherwise shows errors.
// In any case it sets the hover docs if available.
function translateCode(files, onTranslation) {
    clearOutput();
    transok = false;
    
    function onSuccess(json, status, xhr) {
        live_tc.done();
        var translatedcode = json['code'];
        if (translatedcode != null) {
            markCompiled(files);
            try {
                transok = true;
                loadModuleAsString(translatedcode, onTranslation);
            } catch(err) {
                printError("Translated code could not be parsed:");
                printError("--- " + err);
            }
        }
        //errors?
        var errs = json['errors'];
        if (errs && !$.isEmptyObject(errs)) {
            showErrors(errs, translatedcode == null);
        }
    }
    function onError(xhr, status, err) {
        live_tc.done();
        transok = false;
        printError("An error occurred while compiling your code:");
        printError("--- " + (err?err:status));
    }
    
    jQuery.ajax('translate', {
        cache: false, type:'POST',
        dataType: 'json',
        timeout: 20000,
        beforeSend: startSpinner,
        complete: stopSpinner,
        success: onSuccess,
        error: onError,
        contentType: 'application/json; charset=utf-8',
        data: JSON.stringify({
            files: files
        })
    });
}

//Shows the specified error messages in the code
function showErrors(errors, print) {
    if (print) {
        printError("Code contains errors:");
    }
    $.each(errors, function(fileName, fileErrors) {
        $.each(fileErrors, function(index, err) {
            var errmsg = escapeHtml(err.msg);
            var linedelta = isAdvancedModeActive() ? 0 : 2;
            if (print) {
                var msg = ((err.tp == "w") ? "warning: " : "error: ") + err.msg + " " +
                        (err.from.line-linedelta) + ":" + err.from.ch + " of " + fileName;
                printError(msg);
            }
            if (err.from.line > 1) {
                var editor = getEditor(editorId(fileName));
                if (editor != null) {
                    //This is to add a marker in the gutter
                    var underlineStyle;
                    var img = document.createElement('img');
                    img.title = errmsg;
                    if (err.tp == "w") {
                        img.src = "images/warning.png";
                        img.className = "iconwarning"
                        underlineStyle = "cm-warning";
                        getEditorTab(editor.ceylonId).addClass("haswarnings");
                    } else {
                        img.src = "images/error.gif";
                        img.className = "iconerror"
                        underlineStyle = "cm-error";
                        getEditorTab(editor.ceylonId).addClass("haserrors");
                    }
                    editor.setGutterMarker(err.from.line-linedelta-1, 'CodeMirror-error-gutter', img);
                    //This is to modify the style (underline or whatever)
                    var marker = editor.markText({line:err.from.line-linedelta-1,ch:err.from.ch},{line:err.to.line-linedelta-1,ch:err.to.ch+1},{className:underlineStyle});
                    markers.push(marker);
                    //And this is for the hover
                    var estilo = "ceylonerr_r"+err.from.line+"_c"+err.from.ch;
                    marker = editor.markText({line:err.from.line-linedelta-1,ch:err.from.ch},{line:err.to.line-linedelta-1,ch:err.to.ch+1},{className:estilo});
                    markers.push(marker);
                    bindings.push(estilo);
                    $("."+estilo).attr("title", errmsg);
                }
            }
        });
    });
}

function loadModuleAsString(src, func) {
    var outputwin = $("#outputframe")[0].contentWindow;
    if (outputwin.loadModuleAsString) {
        startSpinner();
        outputwin.loadModuleAsString(src, function() {
                func();
                stopSpinner();
            }, function(when, err) {
                stopSpinner();
                if (when == "parsing") {
                    printError("Translated code could not be parsed:");
                    printError("--- " + err);
                } else if (when == "running") {
                    printError("Error running code:");
                    printError("--- " + err);
                } else if (when == "require") {
                    printError("Error loading external modules:");
                    printError("--- " + err);
                } else {
                    printError("Unknown error:");
                    printError("--- " + err);
                }
            }
        );
    }
}

// This function is called if compilation runs OK
function afterTranslate() {
    if (transok == true) {
        clearLangModOutputState();
        //printSystem("// Script start at " + (new Date()));
        try {
            executeCode();
        } catch(err) {
            printError("Runtime error:");
            printError("--- " + err);
        }
        if (!hasLangModOutput()) {
            printSystem("Script ended with no output");
        }
        scrollOutput();
    }
}

function executeCode() {
    var outputwin = $("#outputframe")[0].contentWindow;
    if (outputwin.run) {
        outputwin.run();
    } else {
        printError("Entry point 'run()' not found!")
    }
}

var stopfunc;

function setOnStop(func) {
	if (!stopfunc) {
		stopfunc = func;
		enableButton("run", false);
        enableButton("stop", true);
	}
}

// A way to stop running scripts (that support it!)
function stop() {
	if (stopfunc) {
		try {
			stopfunc();
		} catch(e) {}
		stopfunc = undefined;
        enableButton("run", true);
        enableButton("stop", false);
	}
}

// Retrieves the specified example from the editor, along with its hover docs.
function editSource(src) {
     doReset();
     selectedExample = null;
     selectedGist = null;
     var files = createFilesFromCode(src);
     setEditorSourcesFromGist(files);
     clearListSelectState();
     live_tc.now();
}

function handleEditExample(key) {
    checkForChangesAndRun(function() {
        editExample(key);
    });
}

// Retrieves the specified example from the editor, along with its hover docs.
function editExample(key) {
    // Retrieve code
    live_tc.pause();
    jQuery.ajax('hoverdoc?key='+key, {
        cache:true,
        dataType:'json',
        timeout:20000,
        beforeSend:startSpinner,
        complete:stopSpinner,
        contentType:'application/x-www-form-urlencoded; charset=UTF-8',
        success:function(json, status, xhr) {
            doReset();
            selectedExample = key;
            selectedGist = null;
            markExampleSelected(key);
            setEditorSourcesFromGist(json.files);
            live_tc.now();
        },
        error:function(xhr, status, err) {
            printError("Error retrieving example '" + key + "': " + (err?err:status));
            live_tc.ready();
        }
    });
}

function handleEditGist(key) {
    checkForChangesAndRun(function() {
        editGist(key);
    });
}

// Retrieves the specified code from GitHub
function editGist(key) {
    function onSuccess(gist) {
        selectGist(gist);
        setEditorSourcesFromGist(gist.data.files);
        live_tc.now();
    }
    function onError(xhr, status, err) {
        printError("Error retrieving Gist '" + key + "': " + (err?err:status));
        live_tc.ready();
    }
    
    // Retrieve code
    live_tc.pause();
    github.gist(key).fetch({
        success: onSuccess,
        error: onError
    });
}

// Sets the code for the editor(s) from the given object
function setEditorSourcesFromGist(files) {
    fileDeleted = false;
    clearOutput();
    deleteEditors();
    var cnt = 0;
    var hasModule = false;
    var hasWrapped = false;
    var firstFile, firstCeylonFile, firstEditModeFile;
    $.each(files, function(index, item) {
        if (editorAccepts(index)) {
            if (firstFile == null) {
                firstFile = index;
            }
            if (firstEditModeFile == null && editorMode(index) != null) {
                firstEditModeFile = index;
            }
            if (firstCeylonFile == null && index.endsWith(".ceylon")) {
                firstCeylonFile = index;
            }
            if (index.endsWith(".ceylon")) {
                cnt++;
            }
            if (index.endsWith(".ceylon")
                    && (index != "module.ceylon")
                    && isWrapped(item.content)) {
                hasWrapped = true;
            }
            var neweditor = addSourceEditor(index, item.content);
            if (index == "module.ceylon") {
                hasModule = true;
                if (isWrappedModule(item.content)) {
                    markWrapperReadOnly(neweditor.ceylonId);
                }
            }
        }
    });
    if (!hasModule && (cnt > 1 || cnt == 1 && !hasWrapped)) {
        newModuleFile();
    }
    var selectFile = firstCeylonFile || firstEditModeFile || firstFile;
    if (selectFile != null) {
        selectEditor(editorId(selectFile));
    }
    clearEditorDirtyStates();
    updateMenuState();
    updateAdvancedState();
    live_tc.ready();
}

// Creates a new editor with the given name and source
function addSourceEditor(name, src) {
    var editor = createEditor(name);
    setEditorCode(editor.ceylonId, src);
    return editor;
}

function editorId(name) {
    return "editor_" + name.replace(".", "_");
}

function editorAccepts(name) {
    return editorMode(name) != null
            || name.endsWith(".txt");
}

function compilerAccepts(name) {
    return name.endsWith(".ceylon")
            || name.endsWith(".js");
}

function editorMode(name) {
    if (name.endsWith(".ceylon")) {
        return "ceylon";
    } else if (name.endsWith(".js")) {
        return "javascript";
    } else if (name.endsWith(".md")) {
        return "markdown";
    } else {
        return undefined;
    }
}

function createTab(newid, name, template) {
    w2ui["editortabs"].add({ id: newid, caption: name });
    var tabTemplate = $("#" + template);
    var newTabContent = tabTemplate.clone();
    newTabContent[0].id = newid;
    $("#editorspane").append(newTabContent);
}

function createEditor(name) {
    var newid = editorId(name);
    createTab(newid, name, 'editor-template');
    var textarea = $("#" + newid + " textarea")[0];
    var editor = CodeMirror.fromTextArea(textarea, {
        mode: editorMode(name),
        gutters: ["CodeMirror-error-gutter", "CodeMirror-gutter"],
        lineNumbers: true,
        indentUnit: 4,
        matchBrackets: true,
        styleActiveLine: true,
        autoCloseBrackets: true,
        //highlightSelectionMatches: true,
        extraKeys: {
            "Ctrl-S": function(cm) { handleSaveAll(); },
            "Ctrl-D": function(cm) { fetchDoc(cm); },
            "Cmd-D": function(cm) { fetchDoc(cm); },
            "Ctrl-.": function() { complete(editor); },
            "Cmd-.": function() { complete(editor); }
        }
    });
    editor.ceylonId = newid;
    editor.ceylonName = name;
    editor.on('focus', function() {
        // Hack to mak sure that clicking in the editor correctly
        // closes all popups and deselects their associated buttons
        $().w2overlay();
        buttonCheck("menu", false);
        buttonCheck("connected", false);
    });
    editor.on('change', function() {
        updateEditorDirtyState(editor.ceylonId);
        updateMenuState();
        updateAdvancedState();
        live_tc.postpone();
    });
    editor.on('cursorActivity', function() {
        if (closePopups) closePopups();
        closePopups = undefined;
    });
    return editor;
}

function getEditorDiv(id) {
    return $("#" + id);
}

function getEditorTab(id) {
    return $("#tabs_editortabs_tab_" + id);    
}

function getEditor(id) {
    var codemirrordiv = $("#" + id + " > div");
    if (codemirrordiv.length == 1) {
        return codemirrordiv[0].CodeMirror;
    } else {
        return null;
    }
}

function getEditors() {
    var editors = [];
    var codemirrordivs = $("#editorspane > div > div");
    codemirrordivs.each(function(index, item) {
        editors.push(item.CodeMirror);
    });
    return editors;
}

function selectEditor(id) {
    w2ui["editortabs"].select(id);
    $("#editorspane > div").addClass("invis");
    getEditorDiv(id).removeClass("invis");
    var editor = getEditor(id);
    editor.refresh();
    editor.focus();
}

function isEditorDirty(id) {
    var editor = getEditor(id);
    var src = editor.getValue();
    var oldsrc = editor.ceylonSavedSource;
    return (src != oldsrc);
}

function isEditorRenamed(id) {
    var editor = getEditor(id);
    return editor.ceylonSavedName != editor.ceylonName;
}

function updateEditorDirtyState(id) {
    // Setting the tab state resets any classes we might
    // have added, so we store their states
    var tab = getEditorTab(id);
    var hasErr = tab.hasClass("haserrors");
    var hasWrn = tab.hasClass("haswarnings");
    
    var caption = getEditor(id).ceylonName;
    if (selectedGist != null && isEditorRenamed(id)) {
        caption = "[" + caption + "]";
    }
    if (isEditorDirty(id)) {
        caption = "*" + caption;
    }
    w2ui["editortabs"].set(id, { caption: caption });

    // We now restore any classes that we found earlier
    if (hasErr) tab.addClass("haserrors");
    if (hasWrn) tab.addClass("haswarnings");
}

function clearEditorDirtyState(id) {
    var editor = getEditor(id);
    editor.ceylonSavedName = editor.ceylonName;
    editor.ceylonSavedSource = editor.getValue();
    updateEditorDirtyState(editor.ceylonId);
}

function clearEditorDirtyStates() {
    var editors = getEditors();
    $.each(editors, function(index, editor) {
        editor.ceylonSavedName = editor.ceylonName;
        editor.ceylonSavedSource = editor.getValue();
        updateEditorDirtyState(editor.ceylonId);
    });
    updateMenuState();
    updateAdvancedState();
    fileDeleted = false;
}

// Returns true is any of the editors is dirty or if
// a file has been deleted since the last save.
// Can have an optional list of editor ids to check
// for (by default all editors are checked)
function isAnyEditorDirty(edids) {
    var dirty = fileDeleted;
    var editors = getEditors();
    $.each(editors, function(index, editor) {
        if (edids == null || $.inArray(editor.ceylonName, edids) >= 0) {
            dirty = dirty || isEditorDirty(editor.ceylonId);
        }
    });
    return dirty;
}

var oldfiles;

function markCompiled(files) {
    oldfiles = JSON.stringify(files);
}

function shouldCompile(files) {
    return JSON.stringify(files) != oldfiles || !transok;
}

function selectedEditorId() {
    // First test is because w2ui keeps returning the previous
    // active state when all tabs have been deleted
    return (w2ui["editortabs"].tabs.length > 0) ? w2ui["editortabs"].active : null;
}

function focusSelectedEditor() {
    var id = selectedEditorId();
    if (id != null) {
        getEditor(id).focus();
    }
}

function getEditorCode(id, noWrap) {
    var editor = getEditor(id);
    var src = editor.getValue();
    var name = editor.ceylonName;
    if (name.endsWith(".ceylon") && (name != "module.ceylon") && !noWrap) {
        return wrapCode(src);
    } else {
        return src;
    }
}

function setEditorCode(id, src, noUnwrap) {
    if (src != getEditorCode(id)) {
        var editor = getEditor(id);
        var name = editor.ceylonName;
        if (name.endsWith(".ceylon") && (name != "module.ceylon") && !noUnwrap) {
            if (isWrapped(src)) {
                src = unwrapCode(src);
            }
        }
        editor.setValue(src);
        if (!noUnwrap) {
            editor.ceylonSavedSource = src;
        }
    }
}

// This will mark the first and final lines of the editor read-only
function markWrapperReadOnly(id) {
    var editor = getEditor(id);
    // First line
    var opts1 = { readOnly:true, inclusiveLeft:true, inclusiveRight:false, atomic: true };
    editor.markText({line:0,ch:0}, {line:1,ch:0}, opts1);
    editor.addLineClass(0, "background", "cm-locked");
    // Last line
    var opts2 = { readOnly:true, inclusiveLeft:false, inclusiveRight:true, atomic: true };
    editor.markText({line:editor.lineCount() - 1,ch:0}, {line:editor.lineCount(),ch:0}, opts2);
    editor.addLineClass(editor.lineCount() - 1, "background", "cm-locked");
}

// Deletes all editors
function deleteEditors() {
    $("#editorspane").empty();
    var tabs = w2ui["editortabs"].tabs;
    // WARNING: do NOT change this to $.each(tabs, ...) !
    $(tabs).each(function(index, item) {
        w2ui["editortabs"].remove(item.id);
    });
    live_tc.done();
}

// This function checks for dirty editors and will run `func()`
// immediately if non of them are. Otherwise it will show a
// question to the user asking if they want to discard the 
// changes. When affirmative `func()` will be run or 'negative()'
// otherwise. Can have an optional list of editor ids to check
// for dirty state (by default all editors are checked)
function checkForChangesAndRun(func, negative, edids) {
    if (isAnyEditorDirty(edids)) {
        var conf = w2confirm("This will discard any changes! Are you sure you want to continue?");
        conf.yes(func);
        if (negative != null) {
            conf.no(negative);
        }
    } else {
        func();
    }
}

function wrapCode(code, noTag) {
	if (isFullScript(code) == false) {
	    if (noTag) {
	        return codePrefix + code + codePostfix;
	    } else {
	        return wrappedTag + codePrefix + code + codePostfix;
	    }
	} else {
		return code;
	}
}

function unwrapCode(code, allowMissingTag) {
    if (isWrapped(code, allowMissingTag)) {
        var len = 0;
        len += (code.startsWith(wrappedTag)) ? wrappedTag.length : 0;
        len += (code.startsWith(codePrefix, len)) ? codePrefix.length : 0;
        return code.substring(len, code.length - codePostfix.length);
    } else {
        return code;
    }
}

function isFullScript() {
    return buttonIsChecked("advanced");
}

function isWrapped(code, allowMissingTag) {
    return code.startsWith(wrappedTag + codePrefix)
        || allowMissingTag && code.startsWith(codePrefix);
}

function isWrappedModule(code) {
    return code.startsWith(modulePrefix) && code.endsWith(modulePostfix);
}

function doReset() {
    clearGist();
    clearOutput();
    clearEditMarkers();
}

// Clears all error markers and hover docs.
function clearEditMarkers() {
    var editors = getEditors();
    $.each(editors, function(index, editor) {
        editor.clearGutter('CodeMirror-error-gutter');
        var tab = getEditorTab(editor.ceylonId);
        tab.removeClass("haswarnings");
        tab.removeClass("haserrors");
    });
    for (var i=0; i<markers.length;i++) {
        markers[i].clear();
    }
    markers=[];
    for (var i=0; i<bindings.length;i++) {
        $(bindings[i]).unbind('mouseenter mouseleave');
    }
    bindings=[];
}

function clearLangModOutputState() {
    var outputwin = $("#outputframe")[0].contentWindow;
    var clear = outputwin.clearLangModOutputState;
    if (clear) {
        clear();
    }
}

function hasLangModOutput() {
    var outputwin = $("#outputframe")[0].contentWindow;
    var hasOutput = outputwin.hasLangModOutput;
    if (hasOutput) {
        return hasOutput();
    }
}

function clearOutput() {
    var outputwin = $("#outputframe")[0].contentWindow;
    var clear = outputwin.clearOutput;
    if (clear) {
        clear();
    }
    focusSelectedEditor();
}

function printOutputLine(txt) {
    var outputwin = $("#outputframe")[0].contentWindow;
    var print = outputwin.printOutputLine;
    if (print) {
        print(txt);
    }
}

function printOutput(txt) {
    var outputwin = $("#outputframe")[0].contentWindow;
    var print = outputwin.printOutput;
    if (print) {
        print(txt);
    }
}

function printSystem(txt) {
    var outputwin = $("#outputframe")[0].contentWindow;
    var print = outputwin.printSystem;
    if (print) {
        print(txt);
    }
}

function printError(txt) {
    var outputwin = $("#outputframe")[0].contentWindow;
    var print = outputwin.printError;
    if (print) {
        print(txt);
    }
}

function scrollOutput() {
    var outputwin = $("#outputframe")[0].contentWindow;
    var scroll = outputwin.scrollOutput;
    if (scroll) {
        scroll();
    }
}

// Basic HTML escaping.
function escapeHtml(html) {
    return (''+html).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function fetchDoc(cm) {
    var code = getEditCode();
    var modcode = getModuleCode();
    var done = false;
    function close() {
        if (done) return;
        done = true;
        jQuery("body").unbind('keydown', close);
        jQuery("body").unbind('click', close);
        help.parentNode.removeChild(help);
    }
    var docHandler = function(json, status, xhr) {
        live_tc.ready();
        if (json && json['name']) {
            if (json['doc']) {
                var pos = editor.cursorCoords(true);
                var help = document.createElement("div");
                help.className = "help infront";
                help.innerHTML = json['doc'];
                help.style.left = pos.left + "px";
                help.style.top = pos.bottom + "px";
                document.body.appendChild(help);
                jQuery("body").keydown(close);
                jQuery("body").click(close);
                closePopups=close;
                help.focus();
            } else if (json['name'].startsWith("ceylon.language::")) {
                var tok = json['name'].substring(17);
                if (json['type'] === 'interface' || json['type'] === 'class') {
                    console.log("URL http://modules.ceylon-lang.org/test/ceylon/language/0.5/module-doc/"
                        + json['type'] + "_" + tok + ".html");
                } else {
                    console.log("URL http://modules.ceylon-lang.org/test/ceylon/language/0.5/module-doc/index.html#" + tok);
                }
            }
        }
    };
    var cursor = editor.getCursor();
    live_tc.pause();
    jQuery.ajax('hoverdoc', {
        cache:false, type:'POST',
        dataType:'json',
        timeout:20000,
        beforeSend:startSpinner,
        complete:stopSpinner,
        success:docHandler,
        error:function(xhr,status,err){
            transok = false;
            live_tc.ready();
            w2alert("An error occurred while retrieving documentation for your code: " + err?err:status, "Error");
        },
        contentType:'application/x-www-form-urlencoded; charset=UTF-8',
        data:{
            module:modcode,
            ceylon:code,
            r: cursor.line+2,
            c: cursor.ch-1
        }
    });
}

function w2prompt(msg, label, value, title, onClose, onValidate) {
    onValidate = onValidate || function() { return true; }
    if (w2ui.promptform) {
        w2ui.promptform.destroy();
    }
    $().w2form({
        name: 'promptform',
        style: 'border: 0px; background-color: transparent;',
        formHTML: 
            '<div class="w2ui-page page-0">'+
            '    <div class="w2ui-field w2ui-centered">'+
            '        <p id="w2prompt_msg" style="font-size: 120%">' + msg + '</p><br><br>' +
            '        <label id="w2prompt_label">' + label + ':</label>'+
            '        <div>'+
            '           <input name="value" type="text" maxlength="100" style="width: 250px"/>'+
            '        </div>'+
            '    </div>'+
            '</div>'+
            '<div class="w2ui-buttons">'+
            '    <button class="btn" name="ok">Ok</button>'+
            '    <button class="btn" name="cancel">Cancel</button>'+
            '</div>',
        fields: [
            { field: 'value', type: 'text', required: true },
        ],
        record: { 
            value: value,
        },
        actions: {
            "ok": function () {
                if (this.validate().length == 0 && onValidate(w2ui.promptform)) {
                    w2popup.close();
                    onClose(w2ui.promptform.get("value").el.value);
                }
            },
            "cancel": function () { w2popup.close(); onClose(null); },
        }
    });
    w2popup.open({
        title: title,
        body: '<div id="form" style="width: 100%; height: 100%;"></div>',
        modal: true,
        onOpen: function (event) {
            event.onComplete = function () {
                $('#w2ui-popup #form').w2render('promptform');
            }
        }
    });
}

function addUserGistsContainer() {
    $("#sidebarblock > div").append('<h3 id="yrcodehdr" class="invis">Your code:</h3>');
    $("#sidebarblock > div").append('<ol id="yrcode" class="invis"></ol>');
    $("#sidebarblock > div").append('<a id="yrcodemore" class="invis" href="#" onCLick="">more...</a>');
}

function addExamplesContainer() {
    $("#sidebarblock > div").append('<h3 id="exampleshdr">Try out a sample:</h3>');
    $("#sidebarblock > div").append('<ol id="examples"></ol>');
}

function addExample(key, title) {
    $("#examples").append('<li id="example_' + key + '" class="news_entry"><a href="#" onClick="return handleEditExample(\'' + key + '\')">' + title + '</a></li>');
}

function addExamples() {
    $("#examples").empty();
    addExample("hello_world", "Hello World");
    addExample("basics", "Basics");
    addExample("null_and_union", "Null values and union types");
    addExample("conditions", "Conditions and assertions");
    addExample("classes_and_functions", "Classes and functions 1");
    addExample("interfaces", "Interfaces and mixin inheritance");
    addExample("classes_and_functions2", "Classes and functions 2");
    addExample("collections", "Collections and sequence comprehensions");
    addExample("named_arguments", "Named argument syntax");
    addExample("generics", "Type parameters");
    addExample("switch1", "Enumerations and the switch statement");
    addExample("interop", "Interoperability");
    addExample("request", "Interoperability 2");
    addExample("dynints", "Dynamic interfaces");
    addExample("operators", "Operator polymorphism");
    addExample("metamodel", "Type-safe Metamodel");
    addExample("game_of_life", "Game of Life");
    addExample("importtest1", "Local Import");
    addExample("importtest2", "Module Import");
}
