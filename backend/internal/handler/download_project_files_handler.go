// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package handler

import (
	"archive/zip"
	"fmt"
	"io"
	"mime"
	"net/http"
	"path"
	"strings"

	"digital-assets/backend/internal/files"
	"digital-assets/backend/internal/logic"
	"digital-assets/backend/internal/svc"
	"digital-assets/backend/internal/types"
	"github.com/zeromicro/go-zero/core/logc"
	"github.com/zeromicro/go-zero/rest/httpx"
)

func DownloadProjectFilesHandler(svcCtx *svc.ServiceContext) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req types.ProjectIDRequest
		if err := httpx.Parse(r, &req); err != nil {
			httpx.ErrorCtx(r.Context(), w, err)
			return
		}

		l := logic.NewDownloadProjectFilesLogic(r.Context(), svcCtx)
		archive, err := l.DownloadProjectFiles(&req)
		if err != nil {
			httpx.ErrorCtx(r.Context(), w, err)
			return
		}
		writeArchive(w, r, archive)
	}
}

func writeArchive(w http.ResponseWriter, r *http.Request, archive *files.Archive) {
	defer archive.Close()
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": archive.Name}))
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-store")
	writer := zip.NewWriter(w)
	usedNames := map[string]struct{}{}
	var streamErr error
	for _, item := range archive.Files {
		header := &zip.FileHeader{Name: uniqueArchiveName(item.Name, usedNames), Method: zip.Store}
		header.SetModTime(item.Updated)
		entry, createErr := writer.CreateHeader(header)
		if createErr != nil {
			streamErr = createErr
			break
		}
		if _, copyErr := io.Copy(entry, item.File); copyErr != nil {
			streamErr = copyErr
			break
		}
	}
	if closeErr := writer.Close(); streamErr == nil {
		streamErr = closeErr
	}
	if streamErr != nil {
		logc.Error(r.Context(), "project archive stream failed")
	}
}

func uniqueArchiveName(name string, used map[string]struct{}) string {
	candidate := name
	ext := path.Ext(name)
	base := strings.TrimSuffix(name, ext)
	for index := 2; ; index++ {
		key := strings.ToLower(candidate)
		if _, exists := used[key]; !exists {
			used[key] = struct{}{}
			return candidate
		}
		candidate = fmt.Sprintf("%s (%d)%s", base, index, ext)
	}
}
