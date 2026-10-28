// Code scaffolded by goctl. Safe to edit.
// goctl 1.10.1

package handler

import (
	"mime"
	"net/http"

	"digital-assets/backend/internal/logic"
	"digital-assets/backend/internal/svc"
	"digital-assets/backend/internal/types"
	"github.com/zeromicro/go-zero/rest/httpx"
)

func PreviewChatFileHandler(svcCtx *svc.ServiceContext) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var req types.UploadIDRequest
		if err := httpx.Parse(r, &req); err != nil {
			httpx.ErrorCtx(r.Context(), w, err)
			return
		}

		l := logic.NewPreviewChatFileLogic(r.Context(), svcCtx)
		file, err := l.PreviewChatFile(&req)
		if err != nil {
			httpx.ErrorCtx(r.Context(), w, err)
		} else {
			defer file.File.Close()
			w.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": file.Name}))
			w.Header().Set("Content-Type", file.MediaType)
			w.Header().Set("X-Content-Type-Options", "nosniff")
			w.Header().Set("Content-Security-Policy", "sandbox; default-src 'none'")
			w.Header().Set("Cross-Origin-Resource-Policy", "same-origin")
			w.Header().Set("Cache-Control", "private, no-store")
			http.ServeContent(w, r, file.Name, file.Updated, file.File)
		}
	}
}
