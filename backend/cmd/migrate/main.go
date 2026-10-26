package main

import (
	"context"
	"database/sql"
	"digital-assets/backend/migrations"
	_ "github.com/jackc/pgx/v5/stdlib"
	"log"
	"os"
	"time"
)

func main() {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL is required")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		log.Fatal("database configuration invalid")
	}
	defer db.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	if err = migrations.Apply(ctx, db); err != nil {
		log.Fatal(err)
	}
	log.Print("Migrations applied")
}
